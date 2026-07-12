# FreeCORD

**Güvenli, Gizlilik Odaklı ve Self-Hosted İletişim Platformu**

![Python](https://img.shields.io/badge/python-3.8%2B-3776AB?style=flat-square&logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/flask-%23000.svg?style=flat-square&logo=flask&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.io-black?style=flat-square&logo=socket.io&badgeColor=010101)
![WebRTC](https://img.shields.io/badge/WebRTC-333333?style=flat-square&logo=webrtc&logoColor=white)
![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=flat-square&logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/sqlite-%2307405e.svg?style=flat-square&logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)

*Bağımsız topluluklar için sıfır telemetri ve uçtan uca kontrol imkanı sunan, WebRTC tabanlı modern iletişim altyapısı.*

---

## İçindekiler

- [Temel Prensipler](#temel-prensipler)
- [Kullanılan Teknolojiler](#kullanılan-teknolojiler)
- [Öne Çıkan Özellikler](#öne-çıkan-özellikler)
- [Kurulum Rehberi](#kurulum-rehberi)
- [Katkıda Bulunma](#katkıda-bulunma)
- [Lisans](#lisans)

---

## Temel Prensipler

* **%100 Self-Hosted:** Tüm veritabanı, medya dosyaları ve mesaj geçmişi kendi donanımınızda barındırılır. Verileriniz asla dışarıya aktarılmaz veya işlenmez.
* **İzole ve Güvenli Ağ:** Socket.IO ve WebRTC bağlantıları doğrudan sunucunuz üzerinden kurulur. Sadece yetki verdiğiniz kullanıcılar ağa dahil olabilir.
* **Sıfır Telemetri:** Arka planda çalışan hiçbir izleme kodu, analitik aracı veya reklam yazılımı barındırmaz.

---

## Kullanılan Teknolojiler

Modern mimari standartlarına uygun olarak inşa edilen FreeCORD'un arka planında çalışan çekirdek teknolojiler şunlardır:

| Kategori | Teknoloji / Sürüm | Açıklama |
| :--- | :--- | :--- |
| **Backend** | `Python 3.8+`, `Flask` | API uç noktaları, kimlik doğrulama ve sunucu yönetimi. |
| **Ağ (Real-time)** | `Socket.IO` | Anlık mesaj iletimi, bildirimler ve çevrimiçi durum yönetimi. |
| **Medya (A/V)** | `LiveKit`, `WebRTC` | Düşük gecikmeli donanımsal ses (Opus) ve görüntü aktarımı. |
| **Konteyner** | `Docker` | Medya sunucusu ve bağımlılıkların izole bir şekilde çalıştırılması. |
| **Frontend** | `HTML5`, `CSS3`, `JS` | Hafif, dinamik ve sürükle-bırak destekli kullanıcı arayüzü. |
| **VeriTabanı** | `SQLite`, `SQAlchemy` | Hafif, sunucusuz veri depolama (İstenirse PostgreSQL'e kolayca geçirilebilir). |

---

## Öne Çıkan Özellikler

### Gerçek Zamanlı Mesajlaşma
* **Dinamik Kanal Yönetimi:** Yönetici paneli üzerinden anında metin kanalları oluşturma, kilitleme veya silme işlemleri.
* **Uçtan Uca Özel Mesaj (DM):** Kullanıcılar arası izole ve güvenli birebir yazışma altyapısı.
* **Zengin Metin ve Güvenlik:** XSS saldırılarına karşı filtrelenmiş canlı Markdown desteği (kalın, italik, kod blokları).
* **Gelişmiş Medya Paylaşımı:** Sürükle-bırak desteği ile dosya yükleme ve Lightbox entegrasyonlu görsel görüntüleme.
* **Etkileşim:** Etiketleme sistemi (`@kullanıcı`, `@everyone`), anlık "Yazıyor..." durumu ve masaüstü/tarayıcı bildirimleri.

### Yüksek Kaliteli Ses ve Görüntü
* **Düşük Gecikmeli İletişim:** Sesin tarayıcı içi yazılımsal filtrelere takılmadan saf donanımsal çiplere aktarılması.
* **Akıllı Gürültü Engelleme (AEC):** Yankı önleme (Echo Cancellation) ve klavye/arka plan gürültüsü filtreleme desteği.
* **Veri Optimizasyonu (DTX):** En yüksek kaliteli `64kbps OPUS` kodeği kullanılırken, sessizlik anlarında veri iletimi kesilerek bant genişliğinden tasarruf edilir.
* **Ekran ve Kamera Paylaşımı:** HD çözünürlükte, güvenlik amaçlı sessiz önizleme destekli yayın imkanı.
* **Dinamik Video Izgarası:** Odaya giren kişi sayısına göre otomatik optimize edilen video matrisi (1x1, 2x1, 2x2) ve aktif konuşmacı vurgusu.

### Ekstra Modüller
* **Senkronize Ortak Radyo:** Tüm sunucu üyelerinin YouTube üzerinden eşzamanlı olarak aynı müziği dinleyebildiği ortak oynatıcı. Sohbeti engellememesi için kişisel bağımsız ses seviyesi kontrolü.
* **Gelişmiş Yetkilendirme:** Kurucu, Admin ve Üye rolleri. Özelleştirilebilir kullanıcı profilleri, biyografiler ve avatarlar.

---

## Kurulum Rehberi

FreeCORD'u yerel ağınızda veya bulut sunucunuzda çalıştırmak için aşağıdaki adımları izleyebilirsiniz.

### 1. Projeyi Klonlayın

```bash
git clone https://github.com/hyped2u/FreeCORD.git
cd FreeCORD
```

### 2. Bağımlılıkları Yükleyin

İzole bir sanal ortam (virtual environment) kullanmanız şiddetle tavsiye edilir:

```bash
python -m venv venv

# Linux/macOS için:
source venv/bin/activate  

# Windows için:
venv\Scripts\activate     

pip install -r requirements.txt
```

### 3. LiveKit Sunucusunu Başlatın

Medya akışının dışarı çıkmaması için LiveKit sunucusunu Docker üzerinden başlatın:

```bash
docker run -d --name livekit \
  -p 7880:7880 \
  -p 7881:7881 \
  -p 7882:7882/udp \
  -e LIVEKIT_KEYS="key: secret" \
  livekit/livekit-server --dev
```

> **Not:** Üretime alırken (production) `LIVEKIT_KEYS` parametresindeki `key` ve `secret` değerlerini tahmin edilemez, güçlü şifrelerle değiştirmeyi unutmayın.

### 4. Ortam Değişkenlerini Ayarlayın

Projenin ana dizininde bir `.env` dosyası oluşturun ve LiveKit bilgilerinizi ekleyin:

```env
LIVEKIT_API_KEY=key
LIVEKIT_API_SECRET=secret
LIVEKIT_URL=ws://127.0.0.1:7880
SECRET_KEY=guvenli_ve_karmasik_bir_gizli_anahtar
```

### 5. Uygulamayı Başlatın

Tüm ayarlar tamamsa, sunucuyu ayağa kaldırın:

```bash
python app.py
```

Uygulama varsayılan olarak `http://127.0.0.1:5000` adresinde hizmet vermeye başlayacaktır. Tarayıcınız üzerinden platforma giriş yapıp ilk hesabı oluşturarak yönetici yetkisine sahip olabilirsiniz.

---

## Katkıda Bulunma

1. Bu depoyu Fork'layın.
2. Kendi özellik dalınızı oluşturun: `git checkout -b ozellik/YeniOzellik`
3. Değişikliklerinizi commit edin: `git commit -m 'Yeni özellik eklendi'`
4. Dalınıza pushlayın: `git push origin ozellik/YeniOzellik`
5. Bir Pull Request (PR) açın.

---

## Lisans

Bu proje **MIT Lisansı** ile lisanslanmıştır. Kodu inceleyebilir, dağıtabilir ve kendi projelerinizde özgürce kullanabilirsiniz. Ayrıntılar için `LICENSE` dosyasına göz atın.
