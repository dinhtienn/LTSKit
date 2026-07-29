# LTSKit

LTSKit là ứng dụng desktop giúp tải, xử lý và dịch nội dung media từ nhiều nền tảng.

## Nền tảng hỗ trợ

- Windows 10/11 64-bit

Hiện tại chưa hỗ trợ macOS và Linux.

## Chức năng chính

- Tải video hoặc âm thanh từ liên kết hỗ trợ, với lựa chọn định dạng và chất lượng.
- Tải playlist hoặc kênh khi nền tảng và liên kết hỗ trợ.
- Tạo phụ đề từ audio/video, dịch phụ đề bằng Gemini và đọc chữ trên màn hình video.
- Ghép phụ đề, làm mờ vùng hình ảnh, thêm logo hoặc giọng đọc vào video.
- Chuyển văn bản hoặc tệp phụ đề thành giọng nói.

## Cài đặt và khởi động

Tải bộ cài phù hợp với hệ điều hành từ trang GitHub Releases của LTSKit, cài đặt rồi mở ứng dụng.

## Lần chạy đầu tiên

Khi thiếu thành phần cần thiết, LTSKit hiển thị màn hình Setup và tự tải chúng về. Hãy giữ kết nối Internet cho đến khi Setup hoàn tất.

Các gói xử lý được phát hành riêng trong prerelease `ltskit-assets-v1`. Nếu Setup báo không tải được thành phần, kiểm tra kết nối Internet và trang Releases của dự án trước khi thử lại.

## Sử dụng nhanh

1. Chọn chức năng ở thanh bên.
2. Chọn thư mục đầu ra nếu cần.
3. Dán liên kết hoặc chọn tệp media.
4. Điều chỉnh các tuỳ chọn phù hợp, chẳng hạn định dạng, phụ đề hoặc giọng nói.
5. Bắt đầu tác vụ và theo dõi tiến trình trong ứng dụng.

## Lưu ý sử dụng

- Bạn chịu trách nhiệm tuân thủ điều khoản của nền tảng nguồn và quy định bản quyền tại khu vực của mình.
- Cookie đăng nhập, API key và các cấu hình cá nhân chỉ nên dùng trên thiết bị bạn tin cậy.
- Một số chức năng cần đăng nhập, Gemini API key hoặc thành phần xử lý được tải ở lần chạy đầu.

## Giấy phép và ghi công

LTSKit phát hành theo giấy phép [MIT](LICENSE).

LTSKit sử dụng các thành phần mã nguồn mở, gồm [ffmpeg](https://ffmpeg.org/legal.html) cho xử lý media và bộ tải xuống mã nguồn mở theo giấy phép Unlicense. Xem [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) để biết chi tiết.
