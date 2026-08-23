# Cloud Notebooks

Hai notebook trong thư mục này là các công cụ chạy trên dịch vụ cloud, tách khỏi engine local của LTSKit.

## OCR cloud

Mở `ocr/ocr-cloud.ipynb` bằng Google Colab hoặc Jupyter. Notebook nhận video và vùng OCR, chạy nhận dạng chữ trên cloud rồi xuất phụ đề. Có thể dùng tọa độ vùng được sao chép từ giao diện LTSKit.

## CapCut Cloud TTS

Mở `capcut/capcut-cloud.ipynb` bằng Google Colab hoặc Jupyter. Notebook dùng dịch vụ CapCut để chuyển nội dung phụ đề thành giọng nói.

### Tham số cần cấu hình

Các tham số nằm trong cell `capcut-config`:

| Tham số | Ý nghĩa |
| --- | --- |
| `SRT_PATH` | Đường dẫn tới file `.srt` đầu vào. Kaggle thường dùng `/kaggle/input/...`; Colab có thể dùng `/content/...` hoặc Google Drive. |
| `OUTPUT_PATH` | Đường dẫn file MP3 cuối cùng, ví dụ `/kaggle/working/video.mp3`. |
| `WORK_DIR` | Thư mục tạm/checkpoint. Nên đặt trong `/kaggle/working` hoặc `/content`. Không đặt vào thư mục input chỉ đọc. |
| `VOICE_ID` | ID giọng CapCut lấy từ danh sách `VOICES` ngay bên dưới cell cấu hình. |
| `SPEED` | Tốc độ đọc cơ bản. `1.0` là mặc định; giá trị lớn hơn đọc nhanh hơn, nhỏ hơn đọc chậm hơn. |
| `PROFILE_COUNT` | Số worker/profile CapCut chạy song song, từ `1` đến `20`. Nên bắt đầu bằng `1`; tăng lên có thể nhanh hơn nhưng dễ gặp `busy`, rate-limit hoặc `SHARK`. |
| `ENABLE_CPS_OPTIMIZATION` | Bật tối ưu CPS và timing voice cue trước khi tạo TTS. Mặc định `False`. |
| `TARGET_CPS` | CPS mục tiêu khi `ENABLE_CPS_OPTIMIZATION=True`. Giá trị khởi đầu nên là `20`. |
| `ENABLE_DUBBING_REWRITE` | Cho phép Gemini rút gọn câu quá dài trước hoặc trong quá trình tạo TTS. Mặc định `False`. |
| `GEMINI_API_KEY` | Gemini API key dùng riêng trong notebook. Để trống nếu không dùng rewrite. Không chia sẻ notebook đã chứa key. |
| `GEMINI_MODEL` | Model Gemini dùng để rewrite, mặc định `gemini-2.5-flash`. |
| `DUBBING_REWRITE_MAX_ATTEMPTS` | Số lần thử rewrite mỗi cue, tối đa `2`. |

Ví dụ cấu hình cơ bản không dùng Gemini:

```python
SRT_PATH = '/kaggle/input/subtitles/video.srt'
OUTPUT_PATH = '/kaggle/working/video.mp3'
WORK_DIR = '/kaggle/working/capcut-tts-work'
VOICE_ID = 'BV421_vivn_streaming'
SPEED = 1.0
PROFILE_COUNT = 1
ENABLE_CPS_OPTIMIZATION = True
TARGET_CPS = 20
ENABLE_DUBBING_REWRITE = False
```

Ví dụ bật cả CPS và Gemini rewrite:

```python
ENABLE_CPS_OPTIMIZATION = True
TARGET_CPS = 20
ENABLE_DUBBING_REWRITE = True
GEMINI_API_KEY = 'DAN_KEY_CUA_BAN_VAO_DAY'
GEMINI_MODEL = 'gemini-2.5-flash'
DUBBING_REWRITE_MAX_ATTEMPTS = 2
```

### CPS và Gemini rewrite

Khi bật CPS optimization, notebook sẽ:

1. Đọc SRT và tính `CPS = số ký tự hiển thị / số giây`.
2. Tận dụng khoảng trống xung quanh cue để giảm CPS nếu có thể.
3. Nếu CPS vẫn cao và Gemini rewrite được bật, rút gọn câu trước khi gọi CapCut TTS.
4. Trim silence đầu/cuối, căn audio và ghép theo timing cuối.

Nếu Gemini rewrite lỗi hoặc không trả về câu hợp lệ, notebook dùng lại câu gốc. Nếu audio vẫn dài, FFmpeg mới dùng tốc độ/cắt như fallback cuối.

### Kết quả và checkpoint

Khi một job hoàn tất, notebook tạo:

```text
video.mp3
video.voiceover.srt
capcut-tts-work/manifest.json
```

`video.voiceover.srt` chứa text và timestamp cuối dùng cho voice-over. Nếu CPS hoặc Gemini rewrite đã thay đổi text/timing, hãy dùng file này cùng với `video.mp3` khi ghép phụ đề vào video. File SRT nguồn không bị sửa.

`manifest.json` lưu kết quả từng cue. Khi chạy lại cùng cấu hình, notebook có thể bỏ qua cue đã hoàn thành. Nếu thay đổi `SRT_PATH`, `VOICE_ID`, `SPEED`, CPS hoặc rewrite settings, checkpoint không tương thích sẽ được tạo lại.

## Cách chạy chung

1. Mở notebook bằng Google Colab hoặc Jupyter Notebook.
2. Chạy các cell cài đặt/phụ thuộc ở đầu notebook.
3. Đọc phần cấu hình đầu notebook và nhập tệp, API key hoặc thông tin cần thiết.
4. Chạy các cell theo thứ tự từ trên xuống.
5. Tải kết quả về máy sau khi notebook hoàn tất.

Lưu ý: dữ liệu và thông tin xác thực nhập vào notebook cloud được gửi tới dịch vụ tương ứng. Không đưa API key hoặc cookie nhạy cảm vào notebook công khai.
