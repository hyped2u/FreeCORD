const socket = io();

// --- SOL/SAĞ PANEL AÇMA/KAPAMA (MOBİL) ---
function toggleSidebar() {
    if (window.innerWidth <= 768) {
        document.querySelector('.sidebar-left').classList.toggle('mobile-open');
    } else {
        document.querySelector('.sidebar-left').classList.toggle('collapsed');
    }
}
function toggleRightSidebar() {
    document.querySelector('.sidebar-right').classList.toggle('mobile-open');
}

window.playNotifSoundEnabled = true;

function playNotificationSound() {
    if (!window.playNotifSoundEnabled) return;
    try {
        if (!window.audioCtx) window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (window.audioCtx.state === 'suspended') window.audioCtx.resume();
        
        const oscillator = window.audioCtx.createOscillator();
        const gainNode = window.audioCtx.createGain();
        
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(600, window.audioCtx.currentTime); 
        oscillator.frequency.exponentialRampToValueAtTime(1000, window.audioCtx.currentTime + 0.1);
        
        gainNode.gain.setValueAtTime(0.2, window.audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, window.audioCtx.currentTime + 0.5);
        
        oscillator.connect(gainNode);
        gainNode.connect(window.audioCtx.destination);
        
        oscillator.start();
        oscillator.stop(window.audioCtx.currentTime + 0.5);
    } catch(e) { console.error("Ses çalınamadı", e); }
}

// --- TOAST BİLDİRİM SİSTEMİ ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'radio') icon = '🎵';
    if (type === 'join') icon = '👋';
    if (type === 'error') icon = '❌';
    
    playNotificationSound(); // Ses efektini çal
    
    toast.innerHTML = `<span style="font-size:20px;">${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// --- MESAJ VE FOTOĞRAF GÖNDERME İŞLEMİ ---
async function sendMessage(event) {
    if (event.key === "Enter" || event.type === "click") {
        const inputField = document.getElementById("message-input");
        const imageInput = document.getElementById("image-input");
        
        const messageText = inputField.value.trim();
        const currentDisplayName = document.getElementById("panel-display-name").innerText;
        let avatarBg = document.querySelector('.my-avatar').style.backgroundImage;
        if (avatarBg) {
            avatarBg = avatarBg.replace(/"/g, "'");
        }

        // Hem mesaj boşsa hem de fotoğraf seçilmemişse hiçbir şey yapma
        if (messageText === "" && (!imageInput.files || imageInput.files.length === 0)) {
            return; 
        }

        let data = {
            text: messageText,
            author: currentDisplayName,
            avatarBg: avatarBg,
            image_url: null,
            chatType: currentChatType,
            chatTarget: currentChatTarget
        };

        // Eğer bilgisayardan bir fotoğraf seçilmişse önce arka planda sunucuya upload et
        if (imageInput.files && imageInput.files.length > 0) {
            const formData = new FormData();
            formData.append("file", imageInput.files[0]);

            try {
                const response = await fetch('/upload_image', {
                    method: 'POST',
                    body: formData
                });
                const result = await response.json();
                
                if (result.success) {
                    // Yükleme başarılıysa sunucunun verdiği yerel dosya yolunu al
                    data.image_url = result.image_url; 
                } else {
                    alert("Fotoğraf yüklenemedi: " + result.message);
                    return; // Yükleme başarısızsa sohbeti durdur
                }
            } catch (error) {
                console.error("Yükleme hatası:", error);
                alert("Fotoğraf yüklenirken bir ağ hatası oluştu.");
                return;
            }
        }

        // Upload bittiyse (veya sadece normal bir metin mesajıysa) bunu sohbete dağıt
        socket.emit('send_message', data);
        
        // Inputları temizle
        inputField.value = "";
        imageInput.value = "";
    }
}

// --- SUNUCUDAN GELEN MESAJLARI DİNLEYİP EKRANA YAZDIRMA ---
socket.on('receive_message', (data) => {
    // Mesajın şu anki görünüme ait olup olmadığını kontrol et
    const isChannelMessage = (!data.chatType || data.chatType === 'channel');
    const isMyDM = data.chatType === 'dm' && (data.chatTarget === currentChatTarget || data.sender_username === currentChatTarget);
    
    // Bildirim göster (eğer sekmeye bakmıyorsak ve mesaj bize ait değilse)
    const myName = document.getElementById("panel-display-name").innerText;
    const isMyMessage = data.author === myName;
    const isMentioned = data.text && (data.text.includes(`@${myName}`) || data.text.includes('@everyone'));

    if (!isMyMessage) {
        // Eğer @bahsedildiysem ses çal
        if (isMentioned) {
            const audio = new Audio('https://github.com/viktomas/discord-sounds/raw/master/message.mp3');
            audio.play().catch(e => console.log("Ses çalınamadı (etkileşim gerekli):", e));
        }
        
        if (Notification.permission === "granted" && document.hidden) {
            new Notification(data.author, { body: data.text || "Bir fotoğraf gönderdi." });
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted" && document.hidden) {
                    new Notification(data.author, { body: data.text || "Bir fotoğraf gönderdi." });
                }
            });
        }
    }

    if ((currentChatType === 'channel' && !isChannelMessage) || (currentChatType === 'dm' && !isMyDM)) {
        return; // Bu mesaj şu anki ekrana ait değil
    }

    const chatBox = document.getElementById("chat-messages");
    chatBox.innerHTML += createMessageHTML(data);
    chatBox.scrollTop = chatBox.scrollHeight;
});

// --- MESAJ HTML OLUŞTURUCU (YARDIMCI) ---
function createMessageHTML(data) {
    const avatarInitial = data.avatarBg && data.avatarBg !== "none" ? "" : data.author.charAt(0).toUpperCase();
    const imageHtml = data.image_url ? `<div style="margin-top:8px;"><img src="${data.image_url}" style="max-width:250px; border-radius:8px; cursor:zoom-in;" onclick="openLightbox(this.src)"></div>` : '';
    const editedText = data.is_edited ? `<span class="edited-mark" style="font-size:10px; color:#80848e; margin-left:4px;">(düzenlendi)</span>` : '';
    const timeText = data.time || "Şimdi";
    
    // Yalnızca kendi mesajlarımızda (veya adminsek) düzenle/sil butonu çıkar. Şimdilik kendi mesajlarımız.
    const isMyMessage = data.author === document.getElementById("panel-display-name").innerText;
    const actionsHtml = isMyMessage && data.id ? `
        <div class="msg-actions" style="position: absolute; right: 10px; top: -5px; display: none; background: #313338; border-radius: 4px; padding: 2px 4px; box-shadow: 0 0 5px rgba(0,0,0,0.5);">
            <button onclick="editMessage(${data.id}, '${data.text.replace(/'/g, "\\'").replace(/"/g, '\\"')}')" style="background:none; border:none; color:#b5bac1; cursor:pointer; font-size:14px; padding:4px;" title="Düzenle">✏️</button>
            <button onclick="deleteMessage(${data.id})" style="background:none; border:none; color:#f04747; cursor:pointer; font-size:14px; padding:4px;" title="Sil">🗑️</button>
        </div>
    ` : '';

    return `
        <div class="message" id="msg-${data.id}" onmouseenter="this.querySelector('.msg-actions') && (this.querySelector('.msg-actions').style.display='block')" onmouseleave="this.querySelector('.msg-actions') && (this.querySelector('.msg-actions').style.display='none')" style="position:relative;">
            <div class="msg-avatar" style="background-image: ${data.avatarBg};">${avatarInitial}</div>
            <div class="msg-content" style="width: 100%;">
                <div class="msg-header">
                    <span class="msg-author">${data.author}</span>
                    <span class="msg-time">${timeText}</span>
                </div>
                <div class="msg-text">
                    <span class="msg-body-content">${renderMarkdown(data.text)}</span>
                    ${editedText}
                    ${imageHtml}
                </div>
                ${actionsHtml}
            </div>
        </div>
    `;
}

// --- DÜZENLEME VE SİLME İŞLEMLERİ ---
function editMessage(id, oldText) {
    const newText = prompt("Mesajı düzenle:", oldText);
    if (newText !== null && newText.trim() !== "" && newText !== oldText) {
        socket.emit("edit_message", { id: id, text: newText.trim(), chatType: currentChatType, chatTarget: currentChatTarget });
    }
}

function deleteMessage(id) {
    if (confirm("Bu mesajı silmek istediğine emin misin?")) {
        socket.emit("delete_message", { id: id, chatType: currentChatType, chatTarget: currentChatTarget });
    }
}

socket.on('message_edited', (data) => {
    // Aynı ekrandaysak güncelle
    if (data.chatType !== currentChatType || (currentChatType === 'dm' && data.chatTarget !== currentChatTarget && data.username !== currentChatTarget)) return;
    
    const msgElement = document.getElementById(`msg-${data.id}`);
    if (msgElement) {
        const bodyContent = msgElement.querySelector('.msg-body-content');
        if (bodyContent) bodyContent.innerHTML = renderMarkdown(data.text);
        
        // Edited text'i ekle eğer yoksa
        let editedMark = msgElement.querySelector('.edited-mark');
        if (!editedMark) {
            const msgTextDiv = msgElement.querySelector('.msg-text');
            editedMark = document.createElement('span');
            editedMark.className = 'edited-mark';
            editedMark.style = 'font-size:10px; color:#80848e; margin-left:4px;';
            editedMark.innerText = '(düzenlendi)';
            // imageHtml'den önce eklemek için bodyContent'in hemen sonrasına ekle
            bodyContent.parentNode.insertBefore(editedMark, bodyContent.nextSibling);
        }
        
        // Butondaki oldText'i güncelle
        const editBtn = msgElement.querySelector('button[title="Düzenle"]');
        if (editBtn) {
            editBtn.setAttribute('onclick', `editMessage(${data.id}, '${data.text.replace(/'/g, "\\'").replace(/"/g, '\\"')}')`);
        }
    }
});

socket.on('message_deleted', (data) => {
    // Aynı ekrandaysak sil
    if (data.chatType !== currentChatType || (currentChatType === 'dm' && data.chatTarget !== currentChatTarget && data.username !== currentChatTarget)) return;
    
    const msgElement = document.getElementById(`msg-${data.id}`);
    if (msgElement) {
        msgElement.remove();
    }
});

// --- MARKDOWN VE HTML KORUMASI ---
function renderMarkdown(text) {
    if (!text) return "";
    
    // 1. Önce HTML etiketlerini zararsız hale getir (Güvenlik)
    let escaped = text.replace(/&/g, "&amp;")
                      .replace(/</g, "&lt;")
                      .replace(/>/g, "&gt;")
                      .replace(/"/g, "&quot;")
                      .replace(/'/g, "&#039;");
                      
    // 2. Markdown biçimlendirmeleri
    // **kalın**
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // *italik*
    escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // `kod`
    escaped = escaped.replace(/`(.*?)`/g, '<code style="background: rgba(30,31,34,0.6); padding: 2px 4px; border-radius: 4px; font-family: monospace;">$1</code>');
    
    // 3. Linkleri tıklanabilir yapma (Önizleme Aşama 1)
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    escaped = escaped.replace(urlRegex, function(url) {
        return `<a href="${url}" target="_blank" style="color: #00a8fc; text-decoration: none;">${url}</a>`;
    });
    
    // 4. Etiketleme (@mention)
    const myName = document.getElementById("panel-display-name") ? document.getElementById("panel-display-name").innerText : "";
    escaped = escaped.replace(/@(\w+)/g, function(match, username) {
        if (username === myName || username === "everyone") {
            return `<span style="background: rgba(250, 166, 26, 0.2); color: #faa61a; padding: 2px 4px; border-radius: 4px; font-weight: bold;">@${username}</span>`;
        }
        return `<span style="background: rgba(88, 101, 242, 0.2); color: #7289da; padding: 2px 4px; border-radius: 4px; font-weight: bold;">@${username}</span>`;
    });
    
    return escaped;
}

// --- YAZIYOR... (TYPING) ÖZELLİĞİ ---
let typingTimeout = null;
document.addEventListener("DOMContentLoaded", () => {
    const messageInput = document.getElementById("message-input");
    if (messageInput) {
        messageInput.addEventListener("input", () => {
            // Yazdığını backend'e bildir
            socket.emit('typing', {
                chatType: currentChatType,
                chatTarget: currentChatTarget,
                is_typing: true
            });
            
            // 2 saniye yazmazsa "yazmayı bıraktı" de
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                socket.emit('typing', {
                    chatType: currentChatType,
                    chatTarget: currentChatTarget,
                    is_typing: false
                });
            }, 2000);
        });
    }
});

let typingUsers = new Set();
socket.on('user_typing', (data) => {
    // Sadece şu anki ekranda olan yazıyorları göster
    if (data.chatType !== currentChatType || (currentChatType === 'dm' && data.chatTarget !== currentChatTarget && data.username !== currentChatTarget)) {
        return;
    }
    
    const indicator = document.getElementById("typing-indicator");
    if (data.is_typing) {
        typingUsers.add(data.username);
    } else {
        typingUsers.delete(data.username);
    }
    
    if (typingUsers.size > 0) {
        const names = Array.from(typingUsers).join(', ');
        const verb = typingUsers.size > 1 ? 'yazıyorlar...' : 'yazıyor...';
        indicator.innerHTML = `<span style="display:inline-block; margin-right:5px; animation: blink 1.4s infinite both;">💬</span> <strong>${names}</strong> ${verb}`;
        indicator.style.display = 'block';
    } else {
        indicator.style.display = 'none';
    }
});

// --- SESLİ KANAL İŞLEMLERİ ---
let inVoiceChannel = false;
let currentRoom = null;
let currentVoiceChannelName = null;
let isMicMuted = false;
let isDeafened = false;
let isCamOn = false;
let isScreenSharing = false;

function toggleMicrophone() {
    if (!currentRoom || !currentRoom.localParticipant) return;
    isMicMuted = !isMicMuted;
    currentRoom.localParticipant.setMicrophoneEnabled(!isMicMuted);
    const micBtn = document.getElementById('mic-btn');
    micBtn.style.opacity = isMicMuted ? "0.5" : "1";
    micBtn.innerText = isMicMuted ? "🔇" : "🎤";
}

function toggleDeafen() {
    isDeafened = !isDeafened;
    const deafenBtn = document.getElementById('deafen-btn');
    deafenBtn.style.opacity = isDeafened ? "0.5" : "1";
    deafenBtn.innerText = isDeafened ? "🔇" : "🎧";
    
    const audioElements = document.querySelectorAll('audio');
    audioElements.forEach(audio => {
        audio.muted = isDeafened;
    });
    
    if (window.userGainNodes) {
        for (const gain of Object.values(window.userGainNodes)) {
            gain.gain.value = isDeafened ? 0 : (gain.originalVolume || 1.0);
        }
    }
}

async function toggleVoiceChannel(element, channelName) {
     const voiceListId = 'voice-list-' + channelName.replace(/\s/g, '');
     const voiceList = document.getElementById(voiceListId);
           
    // Eğer zaten odadaysak, bağlantıyı kopar, mikrofonu kapat ve çık
    if (inVoiceChannel) {
        if (currentRoom) {
            currentRoom.disconnect();
            currentRoom = null;
        }
        
        socket.emit('leave_voice');
        const oldVoiceListId = 'voice-list-' + (currentVoiceChannelName ? currentVoiceChannelName.replace(/\s/g, '') : 'Oda1');
        const oldVoiceList = document.getElementById(oldVoiceListId);
        if (oldVoiceList) oldVoiceList.innerHTML = '';
        
        inVoiceChannel = false;
        currentVoiceChannelName = null;
        document.getElementById('current-channel-header').innerHTML = `<span style="color: #80848e; font-size: 20px;">#</span> genel-sohbet`;
        document.querySelectorAll('.channel-item').forEach(item => item.classList.remove('active'));
        
        // Web Audio GainNode ve PanNode'ları temizle
        if (window.userGainNodes) {
            window.userGainNodes = {};
        }
        if (window.userPanNodes) {
            window.userPanNodes = {};
        }
        
        document.getElementById('mic-btn').style.display = 'none';
        document.getElementById('deafen-btn').style.display = 'none';
        document.getElementById('cam-btn').style.display = 'none';
        document.getElementById('screen-btn').style.display = 'none';
        
        isMicMuted = false;
        isDeafened = false;
        isCamOn = false;
        isScreenSharing = false;
        
        document.getElementById('mic-btn').innerText = "🎤";
        document.getElementById('mic-btn').style.opacity = "1";
        document.getElementById('deafen-btn').innerText = "🎧";
        document.getElementById('deafen-btn').style.opacity = "1";
        
        document.getElementById('cam-btn').style.opacity = "0.5";
        document.getElementById('cam-btn').style.color = "";
        document.getElementById('screen-btn').style.opacity = "0.5";
        document.getElementById('screen-btn').style.color = "";
        
        document.getElementById('voice-mode-toggles').style.display = 'none';
        switchChatMode('message');
        document.getElementById('video-grid').innerHTML = ''; // Videoları temizle
        
        return;
    }

    // Odaya girme işlemini başlat
    document.querySelectorAll('.channel-item').forEach(item => item.classList.remove('active'));
    element.classList.add('active');

    try {
        // 1. app.py'den bu oda için giriş bileti (Token) al
        const response = await fetch('/get_voice_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_name: channelName })
        });
        const data = await response.json();
        
        if (!data.success) {
            alert("Token alınamadı: " + data.message);
            element.classList.remove('active');
            return;
        }

        // 2. LiveKit Sunucusuna Bağlan (Gürültü Engelleme Aktif, AGC Kapalı)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.hostname}`;
        currentRoom = new LivekitClient.Room({
            audioCaptureDefaults: {
                autoGainControl: true, // Sesi yeterince yüksek iletir
                echoCancellation: true, // Hoparlörden seken yankıyı kesinlikle keser
                noiseSuppression: true // Arka plandaki fan, statik ve cızırtı seslerini temizler
            }
        });

        // Diğer kullanıcılar odaya katıldığında UI'ı güncelle
        currentRoom.on(LivekitClient.RoomEvent.ParticipantConnected, (participant) => {
            updateVoiceRoomUI();
            showToast(`${participant.name || participant.identity || "Biri"} sesli odaya katıldı`, 'join');
        });

        // Diğer kullanıcılar odadan ayrıldığında UI'ı güncelle
        currentRoom.on(LivekitClient.RoomEvent.ParticipantDisconnected, () => {
            updateVoiceRoomUI();
        });

        function updateGridClass() {
            const grid = document.getElementById("video-grid");
            const count = grid.children.length;
            grid.className = "video-grid"; // reset
            if (count > 0) {
                grid.classList.add(`grid-${Math.min(count, 4)}`);
            }
        }

        function addVideoToGrid(track, participant, trackSource) {
            const grid = document.getElementById("video-grid");
            
            // Limit kontrolü (UI limiti toggle fonksiyonlarında yapıldı)
            // Zaten varsa ekleme
            if (document.getElementById(`video-wrapper-${track.sid}`)) return;
            
            const wrapper = document.createElement("div");
            wrapper.id = `video-wrapper-${track.sid}`;
            wrapper.className = "vid-wrapper";
            
            // Videoyu oluştur ve oynatmaya zorla (Siyah ekran hatasını önlemek için)
            const videoElement = track.attach();
            videoElement.style.width = "100%";
            videoElement.style.height = "100%";
            videoElement.style.objectFit = "contain";
            videoElement.setAttribute("playsinline", "true"); // Mobil tarayıcılar için
            wrapper.appendChild(videoElement);
            
            setTimeout(() => {
                videoElement.play().catch(e => console.warn("Video otomatik başlatılamadı:", e));
            }, 100);
            
            const name = participant.name || participant.identity || "Kullanıcı";
            const initial = name.charAt(0).toUpperCase();
            let icon = '📷';
            if (track.source === LivekitClient.Track.Source.ScreenShare) icon = '🖥️';
            if (trackSource === LivekitClient.Track.Source.ScreenShare) icon = '🖥️'; // Fallback
            
            wrapper.innerHTML += `
                <div class="vid-info-overlay">
                    <div class="vid-avatar">${initial}</div>
                    <span class="vid-name">${name}</span>
                    <span class="vid-icon">${icon}</span>
                </div>
            `;
            
            // En fazla 4 video göster
            if (grid.children.length < 4) {
                grid.appendChild(wrapper);
                updateGridClass();
            }
        }

        function removeVideoFromGrid(sid) {
            const wrapper = document.getElementById(`video-wrapper-${sid}`);
            if (wrapper) wrapper.remove();
            updateGridClass();
        }

        // 3. Başkası konuşunca onun sesini tarayıcıda oynat
        currentRoom.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
            if (track.kind === LivekitClient.Track.Kind.Audio) {
                const audioElement = track.attach();
                document.body.appendChild(audioElement); // DOM'a ekle (Zorunlu)
                
                // Web Audio API Routing (Garantili Yöntem - Jitter Buffer sorununu çözer)
                if (!window.audioCtx) {
                    window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                }
                if (window.audioCtx.state === 'suspended') window.audioCtx.resume();
                
                if (!window.userGainNodes) window.userGainNodes = {};
                if (!window.userPanNodes) window.userPanNodes = {};
                
                // HATA ÇÖZÜMÜ: MediaStream yerine MediaElement kaynağı kullanıyoruz. 
                // Bu sayede tarayıcının jitter buffer ve ses gecikme önleyici özellikleri devreye giriyor (Boğuk/Robot ses çözümü).
                const source = window.audioCtx.createMediaElementSource(audioElement);
                const gainNode = window.audioCtx.createGain();
                const panNode = window.audioCtx.createStereoPanner();
                
                gainNode.originalVolume = 1.0;
                gainNode.gain.value = isDeafened ? 0 : 1.0;
                
                panNode.originalPan = 0.0;
                panNode.pan.value = 0.0;
                
                source.connect(gainNode);
                gainNode.connect(panNode);
                panNode.connect(window.audioCtx.destination);
                
                window.userGainNodes[participant.identity] = gainNode;
                window.userPanNodes[participant.identity] = panNode;
                
                // NOT: audioElement.muted = true YAPMIYORUZ! 
                // createMediaElementSource kullandığımızda ses zaten otomatik olarak HTML elementinden çıkıp Graph'a yönlendirilir.
            } else if (track.kind === LivekitClient.Track.Kind.Video) {
                addVideoToGrid(track, participant);
            }
        });
        
        currentRoom.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
            if (track.kind === LivekitClient.Track.Kind.Video) {
                removeVideoFromGrid(track.sid);
            }
        });
        
        currentRoom.on(LivekitClient.RoomEvent.LocalTrackPublished, (publication) => {
            if (publication.track && publication.track.kind === LivekitClient.Track.Kind.Video) {
                addVideoToGrid(publication.track, currentRoom.localParticipant, publication.track.source);
            }
        });
        
        currentRoom.on(LivekitClient.RoomEvent.LocalTrackUnpublished, (publication) => {
            if (publication.track && publication.track.kind === LivekitClient.Track.Kind.Video) {
                removeVideoFromGrid(publication.track.sid);
            }
        });

        // 3.5 Kimin konuştuğunu arayüzde yeşil renkle vurgula (Active Speaker)
        currentRoom.on(LivekitClient.RoomEvent.ActiveSpeakersChanged, (speakers) => {
            // Önce herkesteki 'speaking' sınıfını kaldır
            const users = document.querySelectorAll('.voice-user');
            users.forEach(u => u.classList.remove('speaking'));
            
            // Şimdi sadece konuşanlara 'speaking' sınıfını ekle
            speakers.forEach(speaker => {
                const sName = speaker.name || speaker.identity;
                users.forEach(u => {
                    if (u.querySelector('span').innerText === sName) {
                        u.classList.add('speaking');
                    }
                });
            });
        });

        await currentRoom.connect(wsUrl, data.token);
        
        // 4. MİKROFON İZNİ İSTE VE YAYINA BAŞLA
        await currentRoom.localParticipant.setMicrophoneEnabled(true);

        // Sunucuya odaya girdiğimizi bildir ki herkesin ekranında gözükelim
        socket.emit('join_voice', { channel: channelName });

        inVoiceChannel = true;
        currentVoiceChannelName = channelName;
        document.getElementById('current-channel-header').innerHTML = `🔊 ${channelName} (Bağlandı)`;
        
        // Ses/Mikrofon ve Video butonlarını göster
        document.getElementById('mic-btn').style.display = 'block';
        document.getElementById('deafen-btn').style.display = 'block';
        document.getElementById('cam-btn').style.display = 'block';
        document.getElementById('cam-btn').style.opacity = '0.5';
        document.getElementById('screen-btn').style.display = 'block';
        document.getElementById('screen-btn').style.opacity = '0.5';
        
        document.getElementById('voice-mode-toggles').style.display = 'flex';
        switchChatMode('video');

    } catch (error) {
        console.error("Sesli odaya bağlanılamadı:", error);
        alert("Bağlantı hatası veya mikrofon izni reddedildi!");
        element.classList.remove('active');
    }
}

// --- KANALLAR ARASI GEÇİŞ (GENEL SOHBETE DÖNÜŞ) ---
function switchToChannel(channelName) {
    currentChatType = "channel";
    currentChatTarget = channelName;

    document.getElementById('current-channel-header').innerHTML = `<span style="color: #80848e; font-size: 20px;">#</span> ${channelName.toLowerCase().replace(' ', '-')}`;
    document.getElementById('message-input').placeholder = `#${channelName.toLowerCase().replace(' ', '-')} kanalına mesaj gönder...`;

    document.getElementById('voice-mode-toggles').style.display = 'none';
    switchChatMode('message');

    const chatBox = document.getElementById("chat-messages");
    chatBox.innerHTML = ''; 
    
    // Aktif kanalı sidebar'da da seçili yap
    document.querySelectorAll('.channel-item').forEach(item => {
        item.classList.remove('active');
        if (item.innerText.includes(channelName.toLowerCase().replace(' ', '-'))) {
            item.classList.add('active');
        }
    });
    
    fetch('/get_messages/' + encodeURIComponent(channelName))
    .then(res => res.json())
    .then(messages => {
        if (messages.error) {
            chatBox.innerHTML = `<div style="color:#f04747; padding:20px; text-align:center;">${messages.error}</div>`;
            return;
        }
        messages.forEach(data => {
            data.time = "Geçmiş";
            chatBox.innerHTML += createMessageHTML(data);
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    });
}

// --- PROFİL MODALI VE DÜZENLEME İŞLEMLERİ ---
function openProfileModal() {
    document.getElementById('profileModal').style.display = 'flex';
    toggleEditMode(false);
}

function closeProfileModal(event) {
    if(!event || event.target.id === 'profileModal' || event === true) {
        document.getElementById('profileModal').style.display = 'none';
    }
}

function toggleEditMode(isEdit) {
    document.getElementById('profile-view-mode').style.display = isEdit ? 'none' : 'block';
    document.getElementById('profile-edit-mode').style.display = isEdit ? 'block' : 'none';
}

function saveProfile() {
    const newName = document.getElementById('edit-display-name').value.trim();
    const newBio = document.getElementById('edit-bio').value.trim();
    const avatarInput = document.getElementById('edit-avatar-file');
    let avatarUrl = document.getElementById('edit-avatar-url').value;

    const doUpdate = (url) => {
        fetch('/update_profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ display_name: newName, bio: newBio, avatar_url: url })
        })
        .then(response => response.json())
        .then(data => {
            if(data.success) {
                if(newName !== "") {
                    document.getElementById('modal-display-name').innerText = newName;
                    document.getElementById('panel-display-name').innerText = newName;
                    document.getElementById('sidebar-display-name').innerText = newName;
                }
                if(newBio !== "") {
                    document.getElementById('modal-bio-text').innerText = newBio;
                }
                const avatars = document.querySelectorAll('.my-avatar');
                avatars.forEach(av => {
                    if(url !== "") {
                        av.style.backgroundImage = `url('${url}')`;
                        av.innerHTML = "";
                    } else {
                        av.style.backgroundImage = "none";
                        av.innerHTML = newName ? newName.charAt(0).toUpperCase() : "";
                    }
                });
                toggleEditMode(false);
            } else {
                alert("Hata: " + data.message);
            }
        });
    };

    if (avatarInput.files && avatarInput.files.length > 0) {
        const formData = new FormData();
        formData.append("file", avatarInput.files[0]);
        fetch('/upload_image', { method: 'POST', body: formData })
        .then(res => res.json())
        .then(data => {
            if (data.success) doUpdate(data.image_url);
            else alert("Fotoğraf yüklenemedi: " + data.message);
        });
    } else {
        doUpdate(avatarUrl);
    }
}

// --- KULLANICI EKLEME İŞLEMLERİ ---
function openAddUserModal() {
    document.getElementById('addUserModal').style.display = 'flex';
}

function closeAddUserModal(event) {
    if(!event || event.target.id === 'addUserModal') {
        document.getElementById('addUserModal').style.display = 'none';
    }
}

function submitNewUser() {
    const un = document.getElementById('new-username').value.trim();
    const pw = document.getElementById('new-password').value.trim();

    if(un === "" || pw === "") {
        alert("Lütfen hem kullanıcı adını hem de şifreyi doldurun.");
        return;
    }

    fetch('/add_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: un, password: pw })
    })
    .then(response => response.json())
    .then(data => {
        if(data.success) {
            alert("Kullanıcı başarıyla yaratıldı!");
            document.getElementById('new-username').value = "";
            document.getElementById('new-password').value = "";
            closeAddUserModal();
        } else {
            alert("Hata: " + data.message);
        }
    })
    .catch(err => {
        console.error(err);
        alert("Bağlantı hatası! Backend hazır olmayabilir.");
    });
}

// --- ÇEVRİMİÇİ LİSTESİ GÜNCELLEME ---
socket.on('update_user_list', () => {
    fetch('/get_online_users')
    .then(res => res.json())
    .then(users => {
        const sidebarRight = document.querySelector('.sidebar-right');
        // Başlığı koruyarak listeyi yenile
        sidebarRight.innerHTML = '<div class="role-group">Çevrimiçi</div>';

        users.forEach(u => {
            const avatarStyle = u.avatar ? `background-image: url('${u.avatar}')` : '';
            const initial = !u.avatar ? u.username[0].toUpperCase() : '';
            
            const safeBio = u.bio ? u.bio.replace(/'/g, "&#39;").replace(/"/g, "&quot;") : 'Henüz bir biyografi eklemedi.';
            const roleBadge = u.role_name ? `<span class="role-badge" style="background-color: ${u.role_color}20; color: ${u.role_color}; margin-left: 5px; font-size: 11px; padding: 2px 6px; border-radius: 4px;">${u.role_name}</span>` : '';

            sidebarRight.innerHTML += `
                <div class="user-item" style="cursor: pointer;" onclick="openViewProfile('${u.username}', '${u.real_username}')">
                    <div class="avatar" style="${avatarStyle}">
                        ${initial}
                        <div class="status-dot"></div>
                    </div>
                    <div>
                        <span style="color: white; font-weight: 500;">${u.username}</span>
                        ${roleBadge}
                    </div>
                </div>
            `;
        });
    });
});

// --- SESLİ ODA GÜNCELLEME ---
function updateVoiceRoomUI() {
    // Artık lokal UI güncellemesine gerek yok, bunu tamamen Backend (voice_channels_update) yönetiyor.
}

socket.on('voice_channels_update', (state) => {
    document.querySelectorAll('.voice-users-list').forEach(list => {
        list.innerHTML = '';
        const channelIdStr = list.id.replace('voice-list-', '');
        
        for (const [chName, users] of Object.entries(state)) {
            if (chName.replace(/\s/g, '') === channelIdStr) {
                for (const [username, info] of Object.entries(users)) {
                    const initial = info.avatarBg !== 'none' ? "" : info.display_name.charAt(0).toUpperCase();
                    list.innerHTML += `
                        <div class="voice-user" style="cursor:pointer;" onclick="openViewProfile('${info.display_name}', '${username}')">
                            <div class="avatar" style="width:20px; height:20px; font-size:10px; background-image: ${info.avatarBg};">${initial}</div>
                            <span>${info.display_name}</span>
                        </div>
                    `;
                }
            }
        }
    });
});

// --- GEÇMİŞ MESAJLARI YÜKLEME ---
document.addEventListener("DOMContentLoaded", () => {
    // Bildirim izni iste
    if (Notification.permission !== "denied" && Notification.permission !== "granted") {
        Notification.requestPermission();
    }

    fetch('/get_messages/' + encodeURIComponent(currentChatTarget || 'Genel Sohbet'))
    .then(response => {
        if (!response.ok) throw new Error("Ağ hatası");
        return response.json();
    })
    .then(messages => {
        const chatBox = document.getElementById("chat-messages");
        
        if (messages.error) {
            chatBox.innerHTML = `<div style="color:#f04747; padding:20px; text-align:center;">${messages.error}</div>`;
            return;
        }
        
        // Veritabanından gelen her bir mesajı ekrana bas
        messages.forEach(data => {
            data.time = "Geçmiş";
            chatBox.innerHTML += createMessageHTML(data);
        });
        
        // Mesajlar yüklendikten sonra ekranı en alta kaydır
        chatBox.scrollTop = chatBox.scrollHeight;
    })
    .catch(err => {
        console.error("Geçmiş mesajlar yüklenirken bir hata oluştu:", err);
    });
});

// --- UYGULAMA DURUM DEĞİŞKENLERİ ---
let currentChatType = "channel"; // "channel" veya "dm" olabilir
let currentChatTarget = "Genel Sohbet"; 

// Sayfa yüklendiğinde sol menüdeki DM listesini doldur
document.addEventListener("DOMContentLoaded", () => {
    loadAllUsersForDM();
});

function loadAllUsersForDM() {
    fetch('/get_all_users')
    .then(res => res.json())
    .then(users => {
        const dmList = document.getElementById('dm-users-list');
        if (!dmList) return;
        dmList.innerHTML = '';
        
        users.forEach(u => {
            const avatarBg = u.avatar ? `background-image: url('${u.avatar}')` : '';
            const initial = !u.avatar ? u.display_name[0].toUpperCase() : '';
            
            dmList.innerHTML += `
                <div class="channel-item" onclick="switchToDM('${u.username}', '${u.display_name}')" style="display:flex; align-items:center; gap:10px;">
                    <div class="avatar" style="width:24px; height:24px; font-size:12px; ${avatarBg}">${initial}</div>
                    <span>${u.display_name}</span>
                </div>
            `;
        });
    });
}

// Başkasının profilini ekrana getiren modal
function openViewProfile(username, realUsername) {
    const modal = document.getElementById('viewProfileModal');
    const loading = document.getElementById('vp-loading');
    const content = document.getElementById('vp-content');
    
    // Modalı aç, loading'i göster, içeriği gizle
    modal.style.display = 'flex';
    loading.style.display = 'block';
    content.style.display = 'none';

    // Gerçek kullanıcı adını tut (DM başlatmak için)
    document.getElementById('vp-real-username').value = realUsername;

    // API'den kullanıcı profilini çek
    fetch(`/api/user/${realUsername}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                alert("Kullanıcı bulunamadı.");
                modal.style.display = 'none';
                return;
            }

            // Görünen Ad ve Kullanıcı Adı
            document.getElementById('vp-name').innerText = data.display_name;
            document.getElementById('vp-real-username-display').innerText = `@${data.username}`;
            
            // Bio
            document.getElementById('vp-bio').innerText = data.bio || "Henüz bir biyografi eklemedi.";
            
            // Banner (Rol renginden)
            const banner = document.getElementById('vp-banner');
            banner.style.background = `linear-gradient(135deg, ${data.role_color}, #202225)`;
            
            // Avatar
            const avatarDiv = document.getElementById('vp-avatar');
            const avatarText = document.getElementById('vp-avatar-text');
            if (data.avatar_url) {
                avatarDiv.style.backgroundImage = `url('${data.avatar_url}')`;
                avatarText.innerText = "";
            } else {
                avatarDiv.style.backgroundImage = "none";
                avatarText.innerText = data.display_name.charAt(0).toUpperCase();
            }
            
            // Çevrimiçi/Çevrimdışı Durumu
            const statusDot = document.getElementById('vp-status');
            if (data.is_online) {
                statusDot.style.backgroundColor = '#23a559'; // Yeşil (Online)
            } else {
                statusDot.style.backgroundColor = '#80848e'; // Gri (Offline)
            }
            
            // Rol Rozeti
            const roleBadge = document.getElementById('vp-role-badge');
            roleBadge.innerText = data.role_name;
            roleBadge.style.color = data.role_color;
            roleBadge.style.backgroundColor = `${data.role_color}20`; // %20 Opaklık
            
            // İçeriği Göster
            loading.style.display = 'none';
            content.style.display = 'block';
            
            // Ses Slider Ayarı
            const volContainer = document.getElementById('vp-volume-container');
            const slider = document.getElementById('vp-volume-slider');
            if (volContainer && slider) {
                if (window.userGainNodes && window.userGainNodes[realUsername]) {
                    volContainer.style.display = 'block';
                    const gainVal = window.userGainNodes[realUsername].originalVolume || 1.0;
                    slider.value = Math.round(gainVal * 100);
                    document.getElementById('vp-volume-label').innerText = `%${slider.value}`;
                } else {
                    volContainer.style.display = 'none';
                }
                
                // Pan Ayarı Görünürlüğü
                const panContainer = document.getElementById('vp-pan-container');
                if (inVoiceChannel && window.userPanNodes && window.userPanNodes[realUsername]) {
                    panContainer.style.display = 'block';
                    const panVal = window.userPanNodes[realUsername].originalPan || 0.0;
                    const pSlider = document.getElementById('vp-pan-slider');
                    pSlider.value = Math.round(panVal * 100);
                    
                    const panLabel = document.getElementById('vp-pan-label');
                    if (pSlider.value < 0) panLabel.innerText = 'Sol %' + Math.abs(pSlider.value);
                    else if (pSlider.value > 0) panLabel.innerText = 'Sağ %' + pSlider.value;
                    else panLabel.innerText = 'Merkez';
                } else {
                    panContainer.style.display = 'none';
                }
            }
        })
        .catch(err => {
            console.error("Profil çekilemedi:", err);
            modal.style.display = 'none';
        });
}

// Özel Kullanıcı Sesi Ayarı (Web Audio API)
function changeUserVolume(val) {
    const volumeLabel = document.getElementById('vp-volume-label');
    if (volumeLabel) volumeLabel.innerText = `%${val}`;
    
    const realUsername = document.getElementById('vp-real-username').value;
    const gainVal = parseInt(val) / 100.0;
    
    if (window.userGainNodes && window.userGainNodes[realUsername]) {
        window.userGainNodes[realUsername].originalVolume = gainVal;
        if (typeof isDeafened !== 'undefined' && !isDeafened) {
            window.userGainNodes[realUsername].gain.value = gainVal;
        }
    }
}

// Özel Kullanıcı Ses Dengesi (3D Panner)
function changeUserPan(val) {
    const panLabel = document.getElementById('vp-pan-label');
    if (panLabel) {
        if (val < 0) panLabel.innerText = 'Sol %' + Math.abs(val);
        else if (val > 0) panLabel.innerText = 'Sağ %' + val;
        else panLabel.innerText = 'Merkez';
    }
    
    const realUsername = document.getElementById('vp-real-username').value;
    const panVal = parseInt(val) / 100.0;
    
    if (window.userPanNodes && window.userPanNodes[realUsername]) {
        window.userPanNodes[realUsername].originalPan = panVal;
        window.userPanNodes[realUsername].pan.value = panVal;
    }
}

// Modalın içindeki "Mesaj Gönder" tuşuna basılınca çalışır
function startDM() {
    const targetUsername = document.getElementById('vp-real-username').value;
    const targetDisplayName = document.getElementById('vp-name').innerText;
    document.getElementById('viewProfileModal').style.display = 'none';
    switchToDM(targetUsername, targetDisplayName);
}

// Silindi

// --- VİDEO VE EKRAN PAYLAŞIMI İŞLEMLERİ ---
async function toggleWebcam() {
    if (!currentRoom || !currentRoom.localParticipant) return;
    
    if (!isCamOn) {
        const currentVideos = document.getElementById("video-grid").children.length;
        if (currentVideos >= 4) {
            showToast("Odadaki yayın limiti (4) dolu!", 'error');
            return;
        }
    }
    
    try {
        isCamOn = !isCamOn;
        await currentRoom.localParticipant.setCameraEnabled(isCamOn);
        const camBtn = document.getElementById('cam-btn');
        camBtn.style.opacity = isCamOn ? "1" : "0.5";
        camBtn.style.color = isCamOn ? "#23a559" : "";
    } catch (e) {
        console.error("Kamera açılamadı", e);
        isCamOn = false;
    }
}

async function toggleScreenShare() {
    if (!currentRoom || !currentRoom.localParticipant) return;
    
    if (!isScreenSharing) {
        const currentVideos = document.getElementById("video-grid").children.length;
        if (currentVideos >= 4) {
            showToast("Odadaki yayın limiti (4) dolu!", 'error');
            return;
        }
    }
    
    try {
        isScreenSharing = !isScreenSharing;
        await currentRoom.localParticipant.setScreenShareEnabled(isScreenSharing);
        const screenBtn = document.getElementById('screen-btn');
        screenBtn.style.opacity = isScreenSharing ? "1" : "0.5";
        screenBtn.style.color = isScreenSharing ? "#23a559" : "";
    } catch (e) {
        console.error("Ekran paylaşılamadı", e);
        isScreenSharing = false;
    }
}

function switchChatMode(mode) {
    if (mode === 'message') {
        document.getElementById('chat-messages').style.display = 'block';
        document.getElementById('input-area-container').style.display = 'block';
        document.getElementById('video-area').style.display = 'none';
        
        const btnMsg = document.getElementById('btn-msg-mode');
        const btnVid = document.getElementById('btn-vid-mode');
        if (btnMsg) btnMsg.className = "action-btn btn-primary";
        if (btnVid) btnVid.className = "action-btn btn-secondary";
    } else {
        document.getElementById('chat-messages').style.display = 'none';
        document.getElementById('input-area-container').style.display = 'none';
        document.getElementById('video-area').style.display = 'flex';
        
        const btnMsg = document.getElementById('btn-msg-mode');
        const btnVid = document.getElementById('btn-vid-mode');
        if (btnMsg) btnMsg.className = "action-btn btn-secondary";
        if (btnVid) btnVid.className = "action-btn btn-primary";
    }
}

// Görünümü Genel Sohbetten DM sekmesine geçiren fonksiyon
function switchToDM(username, displayName) {
    currentChatType = "dm";
    currentChatTarget = username;
    
    // Orta ekranın üstündeki başlığı değiştir
    document.getElementById('current-channel-header').innerHTML = `<span style="color: #80848e; font-size: 20px;">@</span> ${displayName}`;
    
    // Alt taraftaki mesaj yazma placeholder'ını değiştir
    document.getElementById('message-input').placeholder = `@${displayName} kullanıcısına mesaj gönder...`;
    
    // Sohbet ekranını temizle (Buraya ileride DM geçmişini yükleme kodu eklenecek)
    const chatBox = document.getElementById("chat-messages");
    chatBox.innerHTML = `
        <div style="text-align:center; padding:50px; color:#b9bbbe;">
            <h2>${displayName}</h2>
            <p>Bu, ${displayName} ile olan özel mesaj geçmişinizin başlangıcıdır.</p>
        </div>
    `;

    fetch('/get_dm_messages/' + username)
    .then(response => response.json())
    .then(messages => {
        messages.forEach(data => {
            data.time = "Geçmiş";
            chatBox.innerHTML += createMessageHTML(data);
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    })
    .catch(err => {
        console.error("DM geçmişi yüklenirken bir hata oluştu:", err);
    });
}

// --- YOUTUBE RADYO İŞLEMLERİ ---
let ytPlayer;
let isRadioCollapsed = false;

function onYouTubeIframeAPIReady() {
    ytPlayer = new YT.Player("youtube-player", {
        height: "160",
        width: "100%",
        videoId: "",
        playerVars: {
            "autoplay": 1,
            "controls": 1,
            "disablekb": 1,
            "rel": 0,
            "modestbranding": 1
        },
        events: {
            "onStateChange": onPlayerStateChange
        }
    });
    
    setTimeout(() => {
        const myName = document.getElementById("panel-display-name").innerText;
        let isKurucu = false;
        document.querySelectorAll(".sidebar-right .user-item").forEach(item => {
            if (item.innerText.includes(myName) && item.innerText.includes("Kurucu")) {
                isKurucu = true;
            }
        });

        if (isKurucu) {
            document.getElementById("youtube-overlay").style.display = "none";
            setInterval(() => {
                if (ytPlayer && typeof ytPlayer.getPlayerState === "function" && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
                    socket.emit('radio_admin_sync', {
                        id: ytPlayer.getVideoData().video_id,
                        elapsed: ytPlayer.getCurrentTime()
                    });
                }
            }, 5000);
        } else {
            document.getElementById("youtube-overlay").style.display = "block";
        }
        
        socket.emit("radio_sync_request");
    }, 1000);
}

function onPlayerStateChange(event) {}

function toggleRadio() {
    isRadioCollapsed = !isRadioCollapsed;
    const body = document.getElementById("radio-body");
    const btn = document.querySelector(".radio-toggle-btn");
    const container = document.getElementById("radio-container");
    if (isRadioCollapsed) {
        body.classList.add("collapsed");
        if (window.innerWidth <= 768) {
            if (container) container.classList.add("mobile-collapsed");
            btn.innerText = "🎵";
        } else {
            btn.innerText = "+";
        }
    } else {
        body.classList.remove("collapsed");
        if (container) container.classList.remove("mobile-collapsed");
        btn.innerText = "-";
    }
}

function submitRadioRequest() {
    const input = document.getElementById("radio-search-input");
    const query = input.value.trim();
    if (!query) return;
    input.value = "";
    
    const myName = document.getElementById("panel-display-name").innerText;
    let isKurucu = false;
    document.querySelectorAll(".sidebar-right .user-item").forEach(item => {
        if (item.innerText.includes(myName) && item.innerText.includes("Kurucu")) {
            isKurucu = true;
        }
    });
    
    if (isKurucu && query.startsWith("!oynat ")) {
        socket.emit("radio_play", { query: query.replace("!oynat ", "") });
    } else if (isKurucu && query.startsWith("http")) {
        socket.emit("radio_play", { query: query });
    } else {
        socket.emit("radio_suggest", { query: query });
    }
}

function playSuggestion(uuid) {
    socket.emit("radio_play", { suggestion_uuid: uuid });
}

function deleteSuggestion(uuid) {
    socket.emit("radio_remove", { suggestion_uuid: uuid });
}

function changeRadioVolume(value) {
    if (ytPlayer && typeof ytPlayer.setVolume === "function") {
        ytPlayer.setVolume(value);
    }
}

socket.on("radio_sync_response", (data) => {
    if (data.current_song) {
        document.getElementById("current-song-info").innerText = `Şu an çalan: ${data.current_song.title} (${data.current_song.suggested_by})`;
        if (ytPlayer && typeof ytPlayer.getVideoData === "function") {
            const currentId = ytPlayer.getVideoData().video_id;
            const elapsed = data.current_song.elapsed || 0;
            
            if (currentId !== data.current_song.id) {
                // Yeni şarkı
                ytPlayer.loadVideoById({
                    videoId: data.current_song.id,
                    startSeconds: elapsed
                });
                // Şarkı değişti Toast'u
                showToast(`Şimdi çalıyor: ${data.current_song.title}`, 'radio');
            } else {
                // Aynı şarkı çalıyor, senkronizasyonu kontrol et
                const playerState = ytPlayer.getPlayerState();
                const currentTime = ytPlayer.getCurrentTime();
                // 3 saniyeden fazla kayma varsa ve video bitmediyse senkronize et
                if (playerState !== YT.PlayerState.ENDED && Math.abs(currentTime - elapsed) > 3) {
                    ytPlayer.seekTo(elapsed, true);
                }
            }
        }
    } else {
        document.getElementById("current-song-info").innerText = "Şu an çalan: Yok";
        if (ytPlayer && typeof ytPlayer.stopVideo === "function") {
            ytPlayer.stopVideo();
        }
    }
    
    const suggestionsDiv = document.getElementById("radio-suggestions");
    suggestionsDiv.innerHTML = "";
    
    const myName = document.getElementById("panel-display-name").innerText;
    let isKurucu = false;
    document.querySelectorAll(".sidebar-right .user-item").forEach(item => {
        if (item.innerText.includes(myName) && item.innerText.includes("Kurucu")) {
            isKurucu = true;
        }
    });

    data.suggestions.forEach(s => {
        let actionsHtml = "";
        if (isKurucu) {
            actionsHtml = `
                <div class="sug-actions">
                    <button class="play-btn" onclick="playSuggestion('${s.uuid}')" title="Hemen Oynat">▶</button>
                    <button class="del-btn" onclick="deleteSuggestion('${s.uuid}')" title="Listeden Sil">✖</button>
                </div>
            `;
        }
        
        suggestionsDiv.innerHTML += `
            <div class="suggestion-item">
                <div class="sug-info">
                    <span class="sug-title" title="${s.title}">${s.title}</span>
                    <span class="sug-author">Öneren: ${s.suggested_by}</span>
                </div>
                ${actionsHtml}
            </div>
        `;
    });
});

socket.on('radio_error', (data) => {
    showToast(data.message, 'error');
});

// --- SÜRÜKLE & BIRAK VE LIGHTBOX (AŞAMA 3) ---
function openLightbox(src) {
    document.getElementById("lightbox-img").src = src;
    document.getElementById("lightbox").style.display = "flex";
}

document.addEventListener("DOMContentLoaded", () => {
    const dragOverlay = document.getElementById("drag-overlay");
    
    window.addEventListener("dragover", (e) => {
        e.preventDefault();
        dragOverlay.style.display = "flex";
    });
    
    window.addEventListener("dragleave", (e) => {
        e.preventDefault();
        if (e.relatedTarget === null) {
            dragOverlay.style.display = "none";
        }
    });
    
    window.addEventListener("drop", (e) => {
        e.preventDefault();
        dragOverlay.style.display = "none";
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith("image/")) {
                const formData = new FormData();
                formData.append('file', file);
                
                fetch('/upload_image', {
                    method: 'POST',
                    body: formData
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        const currentDisplayName = document.getElementById("panel-display-name").innerText;
                        const avatarBg = document.querySelector('.my-avatar').style.backgroundImage;
                        
                        socket.emit('send_message', {
                            text: "",
                            author: currentDisplayName,
                            avatarBg: avatarBg,
                            image_url: data.image_url,
                            chatType: currentChatType,
                            chatTarget: currentChatTarget
                        });
                    } else {
                        alert("Yükleme hatası: " + data.message);
                    }
                });
            }
        }
    });
});

// --- ADMIN PANELI VE DİNAMİK KANALLAR (AŞAMA 3) ---
function loadChannels() {
    fetch('/get_channels')
    .then(res => res.json())
    .then(channels => {
        const container = document.getElementById("dynamic-channels");
        if (!container) return;
        
        let html = "";
        channels.forEach(ch => {
            const lockIcon = ch.is_locked ? "🔒 " : (ch.type === "voice" ? "🔊 " : "# ");
            if (ch.type === "text") {
                html += `<div class="channel-item ${currentChatTarget === ch.name ? 'active' : ''}" onclick="switchToChannel('${ch.name}')">${lockIcon}${ch.name.toLowerCase().replace(/ /g, '-')}</div>`;
            } else if (ch.type === "voice") {
                html += `<div class="channel-item" onclick="toggleVoiceChannel(this, '${ch.name}')">${lockIcon}${ch.name}</div>
                         <div class="voice-users-list" id="voice-list-${ch.name.replace(/\s/g, '')}"></div>`;
            }
        });
        container.innerHTML = html;
        
        // Kanallar çizildikten sonra içindeki kişileri de yükle (Race condition önlemi)
        socket.emit('get_voice_channels_state');
        
        // Admin panelini de güncelle
        const adminList = document.getElementById("admin-channels-list");
        if (adminList) {
            adminList.innerHTML = channels.map(ch => `
                <div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid #3f4147;">
                    <span>${ch.type==='text'?'#':'🔊'} ${ch.name} ${ch.is_locked?'(Kilitli)':''}</span>
                    <div>
                        <button onclick="toggleChannelLock(${ch.id})" style="background:none; border:none; color:#f1c40f; cursor:pointer;" title="Kilitle/Aç">🔒</button>
                        <button onclick="deleteChannel(${ch.id})" style="background:none; border:none; color:#f04747; cursor:pointer;" title="Sil">🗑️</button>
                    </div>
                </div>
            `).join('');
        }
    });
}

function openAdminPanel() {
    document.getElementById("adminPanelModal").style.display = "flex";
    loadChannels();
}

function closeAdminPanel() {
    document.getElementById("adminPanelModal").style.display = "none";
}

function createChannel() {
    const name = document.getElementById("new-channel-name").value;
    const type = document.getElementById("new-channel-type").value;
    if (!name) return;
    
    fetch('/api/admin/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type })
    }).then(res => res.json()).then(data => {
        if (!data.success) alert(data.message);
        document.getElementById("new-channel-name").value = "";
    });
}

function deleteChannel(id) {
    if (!confirm("Kanalı ve içindeki tüm mesajları silmek istiyor musunuz?")) return;
    fetch('/api/admin/channels/' + id, { method: 'DELETE' })
    .then(res => res.json()).then(data => {
        if (!data.success) alert(data.message);
    });
}

function toggleChannelLock(id) {
    fetch('/api/admin/channels/' + id + '/toggle_lock', { method: 'POST' })
    .then(res => res.json()).then(data => {
        if (!data.success) alert(data.message);
    });
}

function changeUserRole() {
    const username = document.getElementById("admin-role-username").value;
    const role = document.getElementById("admin-role-select").value;
    if (!username) return;
    
    fetch('/api/admin/change_role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, role })
    }).then(res => res.json()).then(data => {
        if (data.success) {
            alert("Kullanıcı rolü güncellendi!");
            document.getElementById("admin-role-username").value = "";
        } else {
            alert(data.message);
        }
    });
}

socket.on('channels_updated', () => loadChannels());
document.addEventListener("DOMContentLoaded", () => {
    loadChannels();
});
