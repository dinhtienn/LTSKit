# Cloud Notebooks

Hai notebook trong thư mục này là các công cụ chạy trên dịch vụ cloud, tách khỏi engine local của LTSKit.

## OCR cloud

Mở `ocr/ocr-cloud.ipynb` bằng Google Colab hoặc Jupyter. Notebook nhận video và vùng OCR, chạy nhận dạng chữ trên cloud rồi xuất phụ đề. Có thể dùng tọa độ vùng được sao chép từ giao diện LTSKit.

## CapCut Cloud TTS

Mở `capcut/capcut-cloud.ipynb` bằng Google Colab hoặc Jupyter. Notebook dùng dịch vụ CapCut để chuyển nội dung phụ đề thành giọng nói.

## Cách chạy chung

1. Mở notebook bằng Google Colab hoặc Jupyter Notebook.
2. Chạy các cell cài đặt/phụ thuộc ở đầu notebook.
3. Đọc phần cấu hình đầu notebook và nhập tệp, API key hoặc thông tin cần thiết.
4. Chạy các cell theo thứ tự từ trên xuống.
5. Tải kết quả về máy sau khi notebook hoàn tất.

Lưu ý: dữ liệu và thông tin xác thực nhập vào notebook cloud được gửi tới dịch vụ tương ứng. Không đưa API key hoặc cookie nhạy cảm vào notebook công khai.
