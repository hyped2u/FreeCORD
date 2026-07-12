from werkzeug.utils import secure_filename
import uuid
from livekit.api import AccessToken, VideoGrants
from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit, join_room
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash
import os
import urllib.request
import urllib.parse
import re
import time
from collections import defaultdict

# --- RADYO GLOBAL DEĞİŞKENLERİ ---
radio_current_song = None  # {'id': 'video_id', 'title': 'title', 'suggested_by': 'username'}
radio_suggestions = []     # [{'id': 'video_id', 'title': 'title', 'suggested_by': 'username', 'uuid': 'unique_id'}]
radio_rate_limits = defaultdict(list) # user_id: [timestamp1, timestamp2, ...]

def search_youtube(query):
    # Eğer doğrudan link veya ID verilmişse
    video_id_match = re.search(r'(?:v=|\/)([0-9A-Za-z_-]{11}).*', query)
    if video_id_match:
        video_id = video_id_match.group(1)
        return {'id': video_id, 'title': f'URL Video: {video_id}'}

    try:
        query_string = urllib.parse.urlencode({"search_query": query})
        req = urllib.request.Request("https://www.youtube.com/results?" + query_string, headers={'User-Agent': 'Mozilla/5.0'})
        html_content = urllib.request.urlopen(req).read().decode()
        search_results = re.findall(r'\"videoId\":\"([0-9A-Za-z_-]{11})\".*?\"title\":\{\"runs\":\[\{\"text\":\"(.*?)\"\}\]', html_content)
        for res in search_results:
            if res[1].lower() != "youtube": # Bazen youtube kelimesi title gibi gelebilir
                return {'id': res[0], 'title': res[1]}
    except Exception as e:
        print("YouTube Arama Hatası:", e)
    return None

# ==============================================================================
# 1. UYGULAMA YAPILANDIRMASI VE BAŞLATMA (CONFIG & INIT)
# ==============================================================================
app = Flask(__name__)
app.config['SECRET_KEY'] = 'acayip-gizli-anahtar-123'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///chat.db'  # SQLite veritabanı dosya yolu
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Veritabanı ve Socket.IO bileşenlerinin başlatılması
db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Oturum Yönetimi (Login Manager) Kurulumu
login_manager = LoginManager(app)
login_manager.login_view = 'login'  # Giriş yapmamış kullanıcıların yönlendirileceği sayfa

# ==============================================================================
# 2. VERİTABANI MODELLERİ (MODELS)
# ==============================================================================
class PrivateMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.String(1000), nullable=False)
    image_url = db.Column(db.String(255), nullable=True)
    is_edited = db.Column(db.Boolean, default=False)
    
    sender = db.relationship('User', foreign_keys=[sender_id])
    receiver = db.relationship('User', foreign_keys=[receiver_id])



class Role(db.Model):
    """Kullanıcı rollerini (Kurucu, Üye vb.) ve renklerini tutan tablo"""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    color = db.Column(db.String(20), default="#ffffff")

class User(UserMixin, db.Model):
    """Kullanıcı hesap bilgilerini ve durumlarını tutan ana tablo"""
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    role_id = db.Column(db.Integer, db.ForeignKey('role.id'), nullable=True)
    is_online = db.Column(db.Boolean, default=False)
    display_name = db.Column(db.String(50), nullable=True) 
    avatar_url = db.Column(db.String(255), nullable=True)  
    bio = db.Column(db.String(500), nullable=True)
    
    # İlişkiler (Relationship)
    role = db.relationship('Role', backref=db.backref('users', lazy=True))

    def set_password(self, password):
        """Şifreyi güvenli bir şekilde hash'leyerek kaydeder"""
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        """Girilen şifrenin hash doğrulamasını yapar"""
        return check_password_hash(self.password_hash, password)

class Channel(db.Model):
    """Yazılı ve sesli kanalların bilgilerini tutan tablo"""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    type = db.Column(db.String(10), default="text")  # 'text' veya 'voice'
    is_locked = db.Column(db.Boolean, default=False)

class Message(db.Model):
    """Kanallara gönderilen mesajları kalıcı olarak tutan tablo"""
    id = db.Column(db.Integer, primary_key=True)
    channel_id = db.Column(db.Integer, db.ForeignKey('channel.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.String(1000), nullable=False)
    image_url = db.Column(db.String(255), nullable=True)
    is_edited = db.Column(db.Boolean, default=False)

    # İlişkiler (Relationship)
    user = db.relationship('User', backref=db.backref('messages', lazy=True))

# ==============================================================================
# 3. OTURUM YÖNETİMİ YARDIMCILARI (LOGIN UTILS)
# ==============================================================================
@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))

# ==============================================================================
# 4. İLK KURULUM VE VARSAYILAN VERİLER (DB INIT)
# ==============================================================================
with app.app_context():
    # Veritabanı tablolarını oluştur
    db.create_all()
    
    # Yeni eklenen is_edited sütunları için otomatik migration
    from sqlalchemy import text
    try:
        db.session.execute(text('ALTER TABLE message ADD COLUMN is_edited BOOLEAN DEFAULT 0'))
        db.session.execute(text('ALTER TABLE private_message ADD COLUMN is_edited BOOLEAN DEFAULT 0'))
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        pass
    
    # Eğer sistemde hiç rol tanımlı değilse varsayılan rolleri oluştur
    if not Role.query.first():
        admin_role = Role(name="Kurucu", color="#ff0000")  # Kırmızı renkli Kurucu (Admin)
        member_role = Role(name="Üye", color="#8ab4f8")    # Mavi renkli Üye
        db.session.add_all([admin_role, member_role])
        db.session.commit()

    # Eğer varsayılan yönetici hesabı yoksa oluştur
    if not User.query.filter_by(username="admin").first():
        admin_role = Role.query.filter_by(name="Kurucu").first()
        admin_user = User(username="admin", role=admin_role)
        admin_user.set_password("topsecret123")  # Varsayılan başlangıç şifresi
        
        # İlk varsayılan metin sohbet kanalını aç
        genel_kanal = Channel(name="Genel Sohbet", type="text")
        
        db.session.add(admin_user)
        db.session.add(genel_kanal)
        db.session.commit()
        print("Sistem başarıyla kuruldu! Kullanıcı: admin | Şifre: topsecret123")

# ==============================================================================
# 5. HTTP SAYFA VE API YÖNLENDİRMELERİ (ROUTES & APIS)
# ==============================================================================
@app.route('/get_all_users')
@login_required
def get_all_users():
    """Sol menüdeki DM listesi için tüm kullanıcıları (kendimiz hariç) getirir"""
    # Kendimizi DM listesinde görmemek için filtreliyoruz
    users = User.query.filter(User.id != current_user.id).all()
    liste = []
    for u in users:
        liste.append({
            'username': u.username,
            'display_name': u.display_name if u.display_name else u.username,
            'avatar': getattr(u, 'avatar_url', None),
            'bio': getattr(u, 'bio', 'Henüz bir biyografi eklemedi.')
        })
    return jsonify(liste)


@app.route('/get_online_users')
@login_required
def get_online_users():
    online_users = User.query.filter_by(is_online=True).all()
    liste = []
    for u in online_users:
        liste.append({
            'username': u.display_name if u.display_name else u.username,
            'real_username': u.username, # DM başlatmak için gerçek kullanıcı adı lazım
            'avatar': getattr(u, 'avatar_url', None),
            'bio': getattr(u, 'bio', 'Henüz bir biyografi eklemedi.'), # YENİ
            'role_name': u.role.name if u.role else None,
            'role_color': u.role.color if u.role else None
        })
    return jsonify(liste)




@app.route('/update_profile', methods=['POST'])
@login_required
def update_profile():
    data = request.get_json()
    if data.get('display_name'):
        current_user.display_name = data.get('display_name')
    if data.get('avatar_url') is not None:
        current_user.avatar_url = data.get('avatar_url')
    if data.get('bio') is not None:
        current_user.bio = data.get('bio')
        
    db.session.commit()
    # Profil güncellenince herkesin çevrimiçi listesini yenilemesi için tetikle
    socketio.emit('update_user_list') 
    return jsonify({'success': True, 'message': 'Profil güncellendi'})




# --- KULLANICI EKLEME API'Sİ ---
@app.route('/add_user', methods=['POST'])
@login_required
def add_user():
    """Sisteme yeni bir kullanıcı ekler"""
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    # Boş veri kontrolü
    if not username or not password:
        return jsonify({'success': False, 'message': 'Kullanıcı adı veya şifre boş olamaz.'}), 400

    # Kullanıcı veritabanında zaten var mı kontrolü
    existing_user = User.query.filter_by(username=username).first()
    if existing_user:
        return jsonify({'success': False, 'message': 'Bu kullanıcı adı zaten alınmış.'}), 400

    try:
        # Yeni kullanıcıyı varsayılan olarak "Üye" rolüyle oluştur
        member_role = Role.query.filter_by(name="Üye").first()
        new_user = User(username=username, role=member_role)
        new_user.set_password(password) # Şifreyi hashleyerek güvenli kaydet
        
        db.session.add(new_user)
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Kullanıcı başarıyla oluşturuldu.'})
        
    except Exception as e:
        print("Kullanıcı Ekleme Hatası:", e)
        db.session.rollback() # Hata olursa veritabanını geri al
        return jsonify({'success': False, 'message': 'Sunucu hatası, kayıt yapılamadı.'}), 500

@app.route('/get_channels')
@login_required
def get_channels():
    kanallar = Channel.query.all()
    liste = []
    for k in kanallar:
        liste.append({
            'id': k.id,
            'name': k.name,
            'type': k.type,
            'is_locked': getattr(k, 'is_locked', False)
        })
    return jsonify(liste)

@app.route('/api/admin/channels', methods=['POST'])
@login_required
def create_channel():
    if not current_user.role or current_user.role.name != "Kurucu":
        return jsonify({'success': False, 'message': 'Yetkiniz yok'}), 403
        
    data = request.get_json()
    name = data.get('name')
    ctype = data.get('type', 'text')
    if not name:
        return jsonify({'success': False, 'message': 'Kanal adı boş olamaz'})
        
    if Channel.query.filter_by(name=name).first():
        return jsonify({'success': False, 'message': 'Bu isimde bir kanal zaten var'})
        
    yeni = Channel(name=name, type=ctype, is_locked=False)
    db.session.add(yeni)
    db.session.commit()
    socketio.emit('channels_updated')
    return jsonify({'success': True})

@app.route('/api/admin/channels/<int:channel_id>', methods=['DELETE'])
@login_required
def delete_channel(channel_id):
    if not current_user.role or current_user.role.name != "Kurucu":
        return jsonify({'success': False, 'message': 'Yetkiniz yok'}), 403
        
    kanal = Channel.query.get(channel_id)
    if not kanal:
        return jsonify({'success': False, 'message': 'Bulunamadı'})
        
    Message.query.filter_by(channel_id=kanal.id).delete()
    db.session.delete(kanal)
    db.session.commit()
    socketio.emit('channels_updated')
    return jsonify({'success': True})

@app.route('/api/admin/channels/<int:channel_id>/toggle_lock', methods=['POST'])
@login_required
def toggle_channel_lock(channel_id):
    if not current_user.role or current_user.role.name != "Kurucu":
        return jsonify({'success': False, 'message': 'Yetkiniz yok'}), 403
        
    kanal = Channel.query.get(channel_id)
    if not kanal:
        return jsonify({'success': False, 'message': 'Bulunamadı'})
        
    kanal.is_locked = not kanal.is_locked
    db.session.commit()
    socketio.emit('channels_updated')
    return jsonify({'success': True, 'is_locked': kanal.is_locked})

@app.route('/api/admin/change_role', methods=['POST'])
@login_required
def change_role():
    if not current_user.role or current_user.role.name != "Kurucu":
        return jsonify({'success': False, 'message': 'Yetkiniz yok'}), 403
        
    data = request.get_json()
    username = data.get('username')
    new_role = data.get('role')
    
    target_user = User.query.filter_by(username=username).first()
    role_obj = Role.query.filter_by(name=new_role).first()
    if target_user and role_obj:
        target_user.role = role_obj
        db.session.commit()
        socketio.emit('update_user_list')
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Hata'})


@app.route('/')
@login_required
def index():
    """Ana sohbet arayüzünü (Discord benzeri ekranı) döndürür"""
    return render_template('chat.html')

# Fotoğrafların yükleneceği klasörü uygulamanın başında oluşturuyoruz
app.config['UPLOAD_FOLDER'] = os.path.join('static', 'uploads')
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

@app.route('/upload_image', methods=['POST'])
@login_required
def upload_image():
    """Kullanıcının seçtiği dosyayı sunucuya yükler ve dosya yolunu döndürür"""
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': 'Dosya bulunamadı'})
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'message': 'Dosya seçilmedi'})
        
    if file:
        # Dosya uzantısını al (örneğin .png, .jpg)
        ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'png'
        # Dosya isimleri çakışmasın diye rastgele (uuid) bir isim ver
        filename = f"{uuid.uuid4().hex}.{ext}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        # Dosyayı sunucuya fiziksel olarak kaydet
        file.save(filepath)
        
        # Kaydedilen dosyanın yerel linkini JavaScript'e geri gönder
        return jsonify({'success': True, 'image_url': f"/{filepath}"})



@app.route('/login', methods=['GET', 'POST'])
def login():
    """Kullanıcı giriş işlemlerini yönetir"""
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = User.query.filter_by(username=username).first()
        
        if user and user.check_password(password):
            login_user(user)
            # Giriş yapınca online durumunu aktife çek
            user.is_online = True
            db.session.commit()
            return redirect(url_for('index'))
        else:
            flash("Hatalı kullanıcı adı veya şifre!")
            
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    """Kullanıcı oturumunu kapatır ve durumunu çevrimdışı yapar"""
    current_user.is_online = False
    db.session.commit()
    logout_user()
    return redirect(url_for('login'))

@app.route('/get_messages/<channel_name>')
@login_required
def get_messages(channel_name):
    """Sayfa yenilendiğinde geçmiş sohbet mesajlarını JSON olarak döndürür"""
    kanal = Channel.query.filter_by(name=channel_name).first()
    if not kanal:
        return jsonify([])
        
    if kanal.is_locked and (not current_user.role or current_user.role.name != "Kurucu"):
        return jsonify([])
        
    mesajlar = Message.query.filter_by(channel_id=kanal.id).all()
    
    # Mesajları frontend yapısına uygun bir listeye eşliyoruz
    liste = []
    for m in mesajlar:
        liste.append({
            'id': m.id,
            'text': m.content,
            'author': m.user.display_name if m.user.display_name else m.user.username,
            'avatarBg': f"url('{m.user.avatar_url}')" if m.user.avatar_url else "none",
            'image_url': m.image_url,
            'is_edited': m.is_edited
        })
        
    return jsonify(liste)

@app.route('/get_voice_token', methods=['POST'])
@login_required
def get_voice_token():
    """LiveKit sesli odalarına katılmak için giriş bileti (Token) üretir"""
    data = request.get_json()
    room_name = data.get('room_name')

    if not room_name:
        return jsonify({'success': False, 'message': 'Oda adı belirtilmedi'}), 400

    try:
        # LiveKit Sunucunun API Key ve Secret değerleri (Kendi sunucu bilgilerine göre güncelleyebilirsin)
        api_key = os.getenv('LIVEKIT_API_KEY', 'devkey')
        api_secret = os.getenv('LIVEKIT_API_SECRET', 'secret')

        # Kullanıcıya özel izinlerin tanımlanması
        grant = VideoGrants(room_join=True, room=room_name)
        
        # Token oluşturma işlemi
        access_token = AccessToken(api_key, api_secret)
        access_token.with_identity(current_user.username)
        access_token.with_name(current_user.username)
        access_token.with_grants(grant)
        
        jwt_token = access_token.to_jwt()
        
        return jsonify({'success': True, 'token': jwt_token})
        
    except Exception as e:
        print("Token Üretim Hatası:", e)
        return jsonify({'success': False, 'message': 'Sunucu tarafında token oluşturulamadı.'}), 500

@app.route('/get_dm_messages/<target_username>')
@login_required
def get_dm_messages(target_username):
    target_user = User.query.filter_by(username=target_username).first()
    if not target_user:
        return jsonify([])

    # DM mesajlarını getir (İki tarafın da gönderdikleri)
    mesajlar = PrivateMessage.query.filter(
        ((PrivateMessage.sender_id == current_user.id) & (PrivateMessage.receiver_id == target_user.id)) |
        ((PrivateMessage.sender_id == target_user.id) & (PrivateMessage.receiver_id == current_user.id))
    ).all()
    
    liste = []
    for m in mesajlar:
        liste.append({
            'id': m.id,
            'text': m.content,
            'author': m.sender.display_name if m.sender.display_name else m.sender.username,
            'avatarBg': f"url('{m.sender.avatar_url}')" if m.sender.avatar_url else "none",
            'image_url': m.image_url,
            'is_edited': m.is_edited,
            'chatType': 'dm',
            'chatTarget': target_username
        })
        
    return jsonify(liste)

@app.route('/api/user/<username>', methods=['GET'])
@login_required
def get_user_profile(username):
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404
        
    return jsonify({
        'username': user.username,
        'display_name': user.display_name or user.username,
        'bio': user.bio or '',
        'avatar_url': user.avatar_url or '',
        'is_online': user.is_online,
        'role_name': user.role.name if user.role else 'Üye',
        'role_color': user.role.color if user.role else '#5865F2'
    })

# ==============================================================================
# 5. SOCKET.IO İŞLEMLERİ (GERÇEK ZAMANLI İLETİŞİM)
# ==============================================================================

@socketio.on('send_message')
def handle_message(data):
    if current_user.is_authenticated:
        chat_type = data.get('chatType', 'channel')
        
        if chat_type == 'channel':
            target_channel = data.get('chatTarget', 'Genel Sohbet')
            kanal = Channel.query.filter_by(name=target_channel).first()
            
            if kanal:
                if kanal.is_locked and (not current_user.role or current_user.role.name != "Kurucu"):
                    return # Yetkisiz mesaj gönderme girişimi engellendi
                yeni_mesaj = Message(
                    channel_id=kanal.id, 
                    user_id=current_user.id, 
                    content=data.get('text', ''),
                    image_url=data.get('image_url')
                )
                db.session.add(yeni_mesaj)
                db.session.commit()
                data['id'] = yeni_mesaj.id
                data['is_edited'] = False
            emit('receive_message', data, broadcast=True)
            
        elif chat_type == 'dm':
            target_username = data.get('chatTarget')
            target_user = User.query.filter_by(username=target_username).first()
            if target_user:
                yeni_mesaj = PrivateMessage(
                    sender_id=current_user.id,
                    receiver_id=target_user.id,
                    content=data.get('text', ''),
                    image_url=data.get('image_url')
                )
                db.session.add(yeni_mesaj)
                db.session.commit()
                
                data['id'] = yeni_mesaj.id
                data['is_edited'] = False
                
                # Sadece gönderen ve alıcıya gönder
                data['sender_username'] = current_user.username
                emit('receive_message', data, to=target_user.username)
                emit('receive_message', data, to=current_user.username)

@socketio.on('typing')
def handle_typing(data):
    if current_user.is_authenticated:
        chat_type = data.get('chatType', 'channel')
        target = data.get('chatTarget')
        is_typing = data.get('is_typing', False)
        
        event_data = {
            'username': current_user.display_name or current_user.username,
            'is_typing': is_typing,
            'chatType': chat_type,
            'chatTarget': target
        }
        
        if chat_type == 'channel':
            emit('user_typing', event_data, broadcast=True, include_self=False)
        elif chat_type == 'dm':
            emit('user_typing', event_data, to=target)

@socketio.on('edit_message')
def handle_edit_message(data):
    if current_user.is_authenticated:
        msg_id = data.get('id')
        new_content = data.get('text', '').strip()
        chat_type = data.get('chatType', 'channel')
        
        if not new_content:
            return
            
        if chat_type == 'channel':
            msg = Message.query.get(msg_id)
            if msg and msg.user_id == current_user.id:
                msg.content = new_content
                msg.is_edited = True
                db.session.commit()
                emit('message_edited', {'id': msg_id, 'text': new_content, 'chatType': 'channel'}, broadcast=True)
        elif chat_type == 'dm':
            msg = PrivateMessage.query.get(msg_id)
            if msg and msg.sender_id == current_user.id:
                msg.content = new_content
                msg.is_edited = True
                db.session.commit()
                emit('message_edited', {'id': msg_id, 'text': new_content, 'chatType': 'dm', 'chatTarget': data.get('chatTarget')}, to=msg.receiver.username)
                emit('message_edited', {'id': msg_id, 'text': new_content, 'chatType': 'dm', 'chatTarget': msg.receiver.username}, to=current_user.username)

@socketio.on('delete_message')
def handle_delete_message(data):
    if current_user.is_authenticated:
        msg_id = data.get('id')
        chat_type = data.get('chatType', 'channel')
        
        if chat_type == 'channel':
            msg = Message.query.get(msg_id)
            if msg and (msg.user_id == current_user.id or current_user.role.name == "Kurucu"):
                db.session.delete(msg)
                db.session.commit()
                emit('message_deleted', {'id': msg_id, 'chatType': 'channel'}, broadcast=True)
        elif chat_type == 'dm':
            msg = PrivateMessage.query.get(msg_id)
            if msg and (msg.sender_id == current_user.id or msg.receiver_id == current_user.id):
                db.session.delete(msg)
                db.session.commit()
                emit('message_deleted', {'id': msg_id, 'chatType': 'dm', 'chatTarget': data.get('chatTarget')}, to=msg.receiver.username)
                emit('message_deleted', {'id': msg_id, 'chatType': 'dm', 'chatTarget': msg.receiver.username}, to=current_user.username)

@socketio.on('connect')
def handle_connect():
    if current_user.is_authenticated:
        current_user.is_online = True
        db.session.commit()
        join_room(current_user.username)
        emit('update_user_list', broadcast=True)

# Global Voice Channel State: { 'Kanal Adı': { 'username': {'display_name': '...', 'avatarBg': '...'} } }
voice_channels_state = {}

@socketio.on('join_voice')
def handle_join_voice(data):
    if not current_user.is_authenticated: return
    channel = data.get('channel')
    if not channel: return
    
    # Başka kanaldaysa ordan çıkar
    for ch, users in voice_channels_state.items():
        if current_user.username in users:
            del users[current_user.username]
            
    if channel not in voice_channels_state:
        voice_channels_state[channel] = {}
        
    voice_channels_state[channel][current_user.username] = {
        'display_name': current_user.display_name or current_user.username,
        'avatarBg': f"url('{current_user.avatar_url}')" if current_user.avatar_url else "none"
    }
    emit('voice_channels_update', voice_channels_state, broadcast=True)

@socketio.on('leave_voice')
def handle_leave_voice():
    if not current_user.is_authenticated: return
    changed = False
    for ch, users in voice_channels_state.items():
        if current_user.username in users:
            del users[current_user.username]
            changed = True
    if changed:
        emit('voice_channels_update', voice_channels_state, broadcast=True)

@socketio.on('get_voice_channels_state')
def handle_get_voice_channels_state():
    emit('voice_channels_update', voice_channels_state)

@socketio.on('disconnect')
def handle_disconnect():
    if current_user.is_authenticated:
        current_user.is_online = False
        db.session.commit()
        emit('update_user_list', broadcast=True)
        # Sesten de düşür
        changed = False
        for ch, users in voice_channels_state.items():
            if current_user.username in users:
                del users[current_user.username]
                changed = True
        if changed:
            emit('voice_channels_update', voice_channels_state, broadcast=True)

# --- RADYO SOCKET EVENTLERİ ---
def get_current_song_data():
    if not radio_current_song: return None
    data = radio_current_song.copy()
    if 'start_time' in data:
        data['elapsed'] = time.time() - data['start_time']
    return data

@socketio.on('radio_admin_sync')
def radio_admin_sync(data):
    global radio_current_song
    if not current_user.is_authenticated or not current_user.role or current_user.role.name != "Kurucu": return
    if radio_current_song and radio_current_song.get('id') == data.get('id'):
        radio_current_song['start_time'] = time.time() - float(data.get('elapsed', 0))
        emit('radio_sync_response', {'current_song': get_current_song_data(), 'suggestions': radio_suggestions}, broadcast=True, include_self=False)

@socketio.on('radio_sync_request')
def radio_sync_request():
    emit('radio_sync_response', {'current_song': get_current_song_data(), 'suggestions': radio_suggestions})

@socketio.on('radio_suggest')
def radio_suggest(data):
    if not current_user.is_authenticated: return
    query = data.get('query')
    if not query: return
    
    now = time.time()
    user_times = radio_rate_limits[current_user.id]
    user_times = [t for t in user_times if now - t < 60]
    radio_rate_limits[current_user.id] = user_times
    if len(user_times) >= 4:
        emit('radio_error', {'message': 'Çok hızlı öneri yapıyorsun! Lütfen 1 dakika bekle.'})
        return
        
    radio_rate_limits[current_user.id].append(now)
    
    result = search_youtube(query)
    if result:
        suggestion = {
            'id': result['id'],
            'title': result['title'],
            'suggested_by': current_user.display_name or current_user.username,
            'uuid': uuid.uuid4().hex
        }
        radio_suggestions.append(suggestion)
        emit('radio_sync_response', {'current_song': get_current_song_data(), 'suggestions': radio_suggestions}, broadcast=True)
    else:
        emit('radio_error', {'message': 'Şarkı bulunamadı.'})

@socketio.on('radio_play')
def radio_play(data):
    global radio_current_song
    if not current_user.is_authenticated or not current_user.role or current_user.role.name != "Kurucu":
        emit('radio_error', {'message': 'Sadece kurucu radyoyu kontrol edebilir.'})
        return
        
    query_or_id = data.get('query')
    suggestion_uuid = data.get('suggestion_uuid')
    
    if suggestion_uuid:
        found = next((s for s in radio_suggestions if s['uuid'] == suggestion_uuid), None)
        if found:
            radio_current_song = {'id': found['id'], 'title': found['title'], 'suggested_by': found['suggested_by'], 'start_time': time.time()}
            radio_suggestions.remove(found)
            emit('radio_sync_response', {'current_song': get_current_song_data(), 'suggestions': radio_suggestions}, broadcast=True)
    else:
        result = search_youtube(query_or_id)
        if result:
            radio_current_song = {'id': result['id'], 'title': result['title'], 'suggested_by': 'Admin', 'start_time': time.time()}
            emit('radio_sync_response', {'current_song': get_current_song_data(), 'suggestions': radio_suggestions}, broadcast=True)
        else:
            emit('radio_error', {'message': 'Şarkı bulunamadı.'})

@socketio.on('radio_remove')
def radio_remove(data):
    global radio_suggestions
    if not current_user.is_authenticated or not current_user.role or current_user.role.name != "Kurucu": return
    suggestion_uuid = data.get('suggestion_uuid')
    radio_suggestions = [s for s in radio_suggestions if s['uuid'] != suggestion_uuid]
    emit('radio_sync_response', {'current_song': get_current_song_data(), 'suggestions': radio_suggestions}, broadcast=True)

# ==============================================================================
# 7. UYGULAMANIN ÇALIŞTIRILMASI (RUNNER)
# ==============================================================================
if __name__ == '__main__':
    # Uygulamayı tüm ağa açık (0.0.0.0) ve debug modunda başlatır
    socketio.run(app, debug=True, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)
