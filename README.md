# Newtoki Tool v3.0 🔴

Tải truyện từ **Newtoki** — dùng **Playwright** (stealth) + **Ollama Gemma 4** (AI giải CAPTCHA).

Không cần cài Extension, không cần Chrome thật — scrape trực tiếp, Gemma 4 tự động xử lý CAPTCHA bằng ảnh.

---

## Kiến trúc

```
newtoki-cli.js
    │
    ├── HTTP Scraper (Chế độ mặc định — cực nhanh, tàng hình)
    │    └── Fetch trực tiếp bằng cookie cf_clearance từ Chrome thật
    │
    ├── Playwright (stealth mode) — Chế độ dự phòng (Fallback)
    │    ├── Tự động kích hoạt nếu HTTP bị chặn
    │    └── Auto scroll → lazy-load ảnh để vượt anti-bot
    │
    └── Ollama + Gemma 4 (multimodal)
         ├── Nhận ảnh CAPTCHA (screenshot)
         ├── Đọc text CAPTCHA
         └── Điền đáp án tự động
```

---

## Yêu cầu

| Phần mềm | Phiên bản |
|---|---|
| [Node.js](https://nodejs.org) | ≥ 18 |
| [Ollama](https://ollama.com) | bất kỳ |
| Google Chrome | bất kỳ (tuỳ chọn, để export cookies) |

---

## Cài đặt

### Bước 1 — Clone và cài dependencies

```bash
cd newtoki-tool
npm install
```

### Bước 2 — Cài Chromium cho Playwright

```bash
npm run install-browsers
# hoặc:
npx playwright install chromium
```

### Bước 3 — Cài Ollama + kéo Gemma 4

Tải Ollama tại: **https://ollama.com/download**

Sau khi cài xong, kéo model Gemma 4:

```bash
# Model đầy đủ (~17 GB) — chất lượng cao hơn
ollama pull gemma4

# Model nhỏ (~3 GB) — đủ dùng để giải text CAPTCHA
ollama pull gemma4:e2b
```

> Chỉ cần kéo 1 trong 2. Nếu RAM dưới 8GB, dùng `gemma4:e2b`.

---

## Chạy tool

### Khởi động Ollama (để AI giải CAPTCHA)

Mở terminal riêng và giữ chạy suốt phiên:

```bash
ollama serve
```

---

### Xem danh sách truyện

```bash
node newtoki-cli.js browse --domain newtoki469.com
```

### Bước 1: Tìm kiếm truyện

*Luôn thêm `--domain` để giúp tool chạy nhanh hơn.*

```bash
node newtoki-cli.js search "나 혼자만 레벨업" --domain newtoki469.com
node newtoki-cli.js search "내가 키운 S급들" --domain newtoki469.com
```

> Nhìn kết quả, copy URL của truyện (Ví dụ: `https://newtoki469.com/webtoon/17622285`).
> **Tuyệt đối không tự bịa URL có tên tiếng Hàn ở trong.**

### Bước 2: Xem danh sách chapter

Gắn URL (toàn bộ nội dung là số) bạn vừa copy vào lệnh sau:

```bash
node newtoki-cli.js chapters "https://newtoki469.com/webtoon/17622285"
```

Bảng hiển thị sẽ có đường dẫn URL của từng tập truyện (Ví dụ tập 1: `https://newtoki469.com/webtoon/39471377`).

### Bước 3: Tải truyện

**Tải MỘT tập duy nhất:**
Lấy URL của một tập cụ thể từ Bước 2 để tải:
```bash
node newtoki-cli.js download "https://newtoki469.com/webtoon/39471377"
```

**Tải TẤT CẢ (hoặc nhiều tập):**
Dùng URL gốc của bộ truyện (tại Bước 1) kèm lệnh `download-all`:
```bash
# Tải tất cả
node newtoki-cli.js download-all "https://newtoki469.com/webtoon/17622285"

# Từ tập 1 đến 10
node newtoki-cli.js download-all "https://newtoki469.com/webtoon/17622285" --from 1 --to 10

# Lưu ngoài ổ D
node newtoki-cli.js download-all "https://newtoki469.com/webtoon/17622285" --output "D:/manga"
```

---

## Bật AI giải CAPTCHA (Gemma 4)

Thêm flag `--ai-captcha` vào bất kỳ lệnh nào:

```bash
# Tải chapter, Gemma 4 tự giải CAPTCHA nếu gặp
node newtoki-cli.js download <url> --ai-captcha

# Dùng model nhẹ hơn
node newtoki-cli.js download-all <url> --ai-captcha --model gemma4:e2b

# Tìm kiếm với AI captcha
node newtoki-cli.js search "keyword" --ai-captcha --domain newtoki469.com
```

Tool sẽ tự kiểm tra Ollama và model khi bật `--ai-captcha`. Nếu chưa pull model, sẽ hiển thị hướng dẫn.

---

## Tất cả options

```
Options:
  --domain <domain>    Chỉ định domain Newtoki (vd: newtoki469.com)
  --no-headless        Mở browser có giao diện (debug CAPTCHA thủ công)
  --output <dir>       Thư mục lưu file (mặc định: ./downloads)
  --ai-captcha         Bật Ollama Gemma 4 tự động giải CAPTCHA
  --model <name>       Ollama model name (mặc định: gemma4)
  --browser            Buộc dùng Playwright thay vì HTTP mode

download / download-all:
  --no-zip             Lưu ảnh vào thư mục thay vì ZIP
  --concurrency <n>    Số ảnh tải đồng thời (mặc định: 5)
  --delay <ms>         Delay giữa các chapter (mặc định: 2000)
  --from <n>           Tải từ chapter thứ n
  --to <n>             Tải đến chapter thứ n
```

---

## Xử lý khi bị block Cloudflare (Cách chuẩn nhất)

Hiện tại, Cloudflare rất thông minh và sẽ chặn Playwright ngay từ đầu. Giải pháp triệt để nhất là dùng lệnh **lấy cookie từ Chrome thật**:

**Các bước (Vui lòng đọc kỹ):**

1. Đóng **HOÀN TOÀN TẤT CẢ** các cửa sổ Chrome đang mở trên máy (chọn Close all windows ở taskbar).
2. Chạy lệnh sau trong terminal:
   ```bash
   node newtoki-cli.js get-cookies
   ```
3. Lệnh này sẽ mở một cửa sổ Chrome độc lập. Bạn vào URL của trang truyện và tự tay **bấm giải CAPTCHA**.
4. Khi giải xong, terminal báo `✓ Tìm thấy cf_clearance!`, là đã lưu kết quả thành công.

Sau khi làm xong bước trên, bạn có thể chạy tất cả các thao tác cào truyện của tool bình thường (tool sẽ tự động chạy ngầm và không bị hỏi CAPTCHA lại nữa trong suốt vài ngày/tuần tiếp theo).

## Cấu trúc files

| File | Chức năng |
|---|---|
```bash
# Đảm bảo Ollama đang chạy:
ollama serve

# Kiểm tra model đã pull chưa:
ollama list
```

**Model "gemma4" không tìm thấy?**
```bash
ollama pull gemma4
# hoặc nhẹ hơn:
ollama pull gemma4:e2b
```

**Không tìm thấy ảnh trong chapter?**
- Đảm bảo URL là trang **chapter** (có ảnh), không phải trang danh sách truyện
- Thử thêm `--no-headless` để xem trang thực tế

**Vẫn bị Cloudflare block dù đã giải CAPTCHA?**
1. Nhớ đóng mọi cửa sổ Google Chrome.
2. Chạy lệnh: `node newtoki-cli.js get-cookies`
3. Tự tay tick vào hộp kiểm "Verify you are human" trên tab Chrome vừa bật ra.
4. Chờ terminal báo lưu cookie xong thì dùng tool như bình thường.
