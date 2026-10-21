# GökSim

Tarayıcıda çalışan, GeoFS benzeri bir uçuş simülatörü. Dünya, gerçek uydu görüntüleriyle kaplı 3D bir küre olarak gösterilir. Derleme adımı yoktur; dosyaları GitHub'a yükleyip Pages'i açmanız yeterlidir.

## Özellikler

- **Dünya:** CesiumJS ile gerçek uydu görüntülü dünya. İsteğe bağlı olarak Cesium ion anahtarıyla 3D arazi ve 3D binalar açılabilir.
- **Uçaklar:** Beş uçak var: eğitim uçağı, kuyruk tekerlekli hafif uçak, yolcu jeti, art yakıcılı jet avcı ve vinçle kalkan planör.
- **Fizik:**
  - kaldırma, sürükleme, stall ve flaplar
  - yer etkisi, rüzgâr ve türbülans
  - yaylı iniş takımı, fren ve burun tekerleği
  - sert inişte, kanat ucu ya da pervane yere değince düşme
- **Hareketli modeller:** Dümenler, flaplar, spoilerlar, pervane, katlanır iniş takımı ve art yakıcı alevi.
- **Gösterge paneli:** Altılı gösterge ve gaz, flap, trim, teker ışıkları ile ikazları gösteren durum sütunu.
- **Otopilot:** Hız, irtifa, dikey hız ve baş tutar. Hız koruması vardır.
- **Havalimanları:** Yaklaşık 4.000 havalimanı gerçek pist koordinatlarıyla yüklüdür. "Pistte başla" ya da "Yaklaşmada başla" (10 km, 3° süzülüş) seçilebilir.
- **Harita:** Uçağın izini gösterir. Sağ tıkla haritadaki herhangi bir yere ışınlanılır.
- **Kameralar:** Takip, kokpit, serbest ve kule.
- **Kontroller:** Klavye, fare (yoke), oyun kumandası ve dokunmatik ekran.
- **Sesler:** Motor, jet, rüzgâr, tekerlek ve stall uyarısı. Ses dosyası yoktur, hepsi tarayıcıda üretilir.

## Gerçekçi mod

**Ayarlar → Gerçekçilik → Gerçekçi mod** ile açılır. Kapalıyken oyun bugünkü gibi bağışlayıcıdır.

| Konu | Gerçekçi modda |
|---|---|
| Başlangıç | Pistte motor kapalı, park freni çekili. `E` ile motoru çalıştırın, `Shift+B` ile freni bırakın. |
| Motor çalıştırma | Pistonlu motor yaklaşık 3 sn, jetler 20–30 sn. |
| Yakıt | Tükenir; uçak hafifler. Bitince motor durur. |
| Pervane torku | Kalkışta uçak sola çeker; `X` ile hafif sağ dümen gerekir. Otomatik dümen kapalıdır. |
| Yapısal sınırlar | G sınırı aşılınca uyarı verilir; 1,5 katı aşılırsa kanat kırılır. Azami hızın %12 üstü çırpınmaya (flutter) yol açar. |
| Flap ve iniş takımı | Sınır hızın üstünde açık kalırsa hasar görür ve kilitlenir. |
| Stall ve iniş | Stall daha serttir, kanat düşmesi belirgindir. İniş takımı %20 daha az sert inişe dayanır. |
| Otopilot | Hız koruması yalnızca uçuş kontrol bilgisayarı olan uçaklarda (yolcu jeti, jet avcı) çalışır. |
| Göstergeler | Pistonlu uçaklarda ve planörde dikey hız göstergesi gerçek gibi gecikmeli tepki verir. |

## GitHub Pages'de yayınlama

1. GitHub'da yeni bir depo açın (örneğin `goksim`). Herkese açık olabilir.
2. Zip'in içindeki **tüm dosya ve klasörleri** deponun köküne yükleyin. Bunun için "Add file → Upload files" kullanabilir ya da `git push` yapabilirsiniz. `index.html` deponun en üst seviyesinde olmalı.
3. Deponun **Settings → Pages** sayfasına gidin. "Build and deployment" altında **Source: Deploy from a branch** seçin. Dal olarak `main`, klasör olarak `/ (root)` seçip **Save**'e basın.
4. Bir iki dakika sonra oyun `https://KULLANICI-ADINIZ.github.io/goksim/` adresinde açılır.

`.nojekyll` dosyası GitHub'ın dosyaları işlemeye çalışmasını engeller; silmeyin.

## Bilgisayarda çalıştırma

Klasörde bir yerel sunucu başlatıp tarayıcıda açın:

```bash
python3 -m http.server 8000
# sonra: http://localhost:8000
```

İnternet bağlantısı gerekir: Cesium, harita karoları ve uydu görüntüleri internetten yüklenir.

## 3D arazi ve binalar (isteğe bağlı, ücretsiz)

Anahtar olmadan da oyun çalışır; dünya düz bir yüzey üzerinde uydu görüntüsüyle gösterilir. Dağlar ve binalar için:

1. <https://ion.cesium.com/signup> adresinden ücretsiz hesap açın.
2. **Access Tokens** sayfasındaki "Default" anahtarı kopyalayın.
3. Oyunda **Ayarlar → 3D arazi ve binalar** bölümüne yapıştırıp **Kaydet**'e basın.

Anahtar yalnızca sizin tarayıcınızda saklanır, depoya yazılmaz. Oyunu başkalarıyla paylaşırsanız her kullanıcı kendi anahtarını girer.

Binalarla çarpışma yoktur; içlerinden geçebilirsiniz.

## Tuşlar

| Tuş | İşlev |
|---|---|
| ↑ ↓ | Burun aşağı / yukarı |
| ← → | Sola / sağa yatış |
| Z X | İstikamet dümeni, yerde yönlendirme |
| + − ya da Page Up / Page Down | Gaz |
| Home / End, T / Shift+T | Trim |
| F / Shift+F | Flap indir / topla |
| G | İniş takımı |
| B ya da Boşluk (basılı) | Fren |
| Shift+B | Park freni |
| K | Spoiler / hava freni |
| E | Motoru çalıştır / durdur |
| A | Otopilot |
| C, 1–4 | Kamera |
| M | Harita |
| H / I | Gösterge paneli / uçuş bilgileri |
| Y | Fare ile kontrol |
| P | Duraklat |
| R | Yeniden başla |
| F1 ya da ? | Yardım |

Oyun kumandası takılınca kendiliğinden tanınır:

| Kumanda | İşlev |
|---|---|
| Sol çubuk | Yunuslama ve yatış |
| Sağ çubuk | Dümen |
| RT / LT | Gaz |
| A | Fren |
| Y | İniş takımı |
| B / X | Flap |
| LB | Kamera |
| RB | Otopilot |

## Özelleştirme

- **Varsayılan başlangıç yeri:** `js/main.js` içindeki `DEFAULT_SPAWN` satırını değiştirin. Örneğin İzmir için `{ icao: 'LTBJ', rwy: '16L', approach: false }`.
- **Uçak ayarları:** `js/aircraft.js` içinde kütle, kanat alanı, itki, hızlar ve kontrol tepkileri gibi değerler bulunur.
- **Uçak görünümü:** `js/models.js` içindeki `BUILD` fonksiyonları modelleri kodla üretir.
- **Cesium sürümü:** `index.html` içinde `cesium@1.145.0` yazan üç yer vardır. Güncellerken üçünü birlikte değiştirin.

## Dosya yapısı

```
index.html          sayfa ve menüler
css/style.css       görünüm
data/airports.js    havalimanı ve pist verisi
js/math.js          vektör ve kuaterniyon yardımcıları
js/aircraft.js      uçak tanımları
js/physics.js       uçuş dinamiği
js/autopilot.js     otopilot
js/models.js        3D uçak modelleri (GLB üretici)
js/instruments.js   gösterge paneli
js/audio.js         sesler
js/controls.js      klavye, fare, kumanda, dokunmatik
js/camera.js        kamera modları
js/ui.js            paneller, arama, harita, ayarlar
js/main.js          ana döngü ve başlangıç
```

## Bilinen sınırlar

- Çok oyunculu mod yok; GitHub Pages yalnızca statik dosya barındırır, oyuncuları eşleştirecek bir sunucu gerekir.
- Su ile kara ayrımı yapılmıyor; suya "iniş" yapılabilir.
- Binalarla ve ağaçlarla çarpışma yok.
- Düşük güçlü cihazlarda Ayarlar → Grafik kalitesi → Düşük seçin, gölge ve bulutları kapatın.

## Kaynaklar ve lisanslar

- [CesiumJS](https://cesium.com/platform/cesiumjs/): Apache 2.0
- [Leaflet](https://leafletjs.com/): BSD-2
- Havalimanı verisi: [OurAirports](https://ourairports.com/data/), kamu malı
- Uydu görüntüsü: Esri World Imagery. Kullanım koşulları Esri'ye aittir; ticari kullanım için koşullarını kontrol edin.
- Harita: © [OpenStreetMap](https://www.openstreetmap.org/copyright) katkıcıları. Yoğun kullanımda OSM karo kullanım politikasına uyun.
- Yazı tipi: B612 (Airbus için tasarlanmış kokpit yazı tipi), SIL Open Font License
- GökSim'in kendi kodu ve uçak modelleri bu projeye özgüdür; GeoFS ile resmi bir bağı yoktur.
