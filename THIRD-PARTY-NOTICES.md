# LTSKit Third-Party Notices

LTSKit sử dụng các thành phần bên thứ ba được liệt kê dưới đây. Bản quyền, nhãn hiệu và điều khoản sử dụng thuộc về tác giả hoặc tổ chức gốc. Thông tin giấy phép được đối chiếu từ tệp LICENSE, siêu dữ liệu hoặc trang upstream tại thời điểm phát hành.

## Mục lục

- [Tổng quan](#tổng-quan)
- [Công cụ tải và xử lý media](#công-cụ-tải-và-xử-lý-media)
- [Chuyển văn bản thành giọng nói](#chuyển-văn-bản-thành-giọng-nói)
- [Thư viện nhận dạng và xử lý](#thư-viện-nhận-dạng-và-xử-lý)
- [Model AI](#model-ai)
- [Tăng tốc GPU](#tăng-tốc-gpu)
- [Ghi chú giấy phép](#ghi-chú-giấy-phép)

## Tổng quan

| Thành phần | Vai trò trong LTSKit | Giấy phép | Upstream |
| --- | --- | --- | --- |
| ffmpeg | Xử lý, ghép media và nhúng phụ đề | LGPL / GPL | [ffmpeg](https://ffmpeg.org/legal.html) |
| Bộ tải xuống đa nền tảng | Tải nội dung từ các nền tảng hỗ trợ | The Unlicense | Upstream công cụ tải mã nguồn mở |
| Bộ tải Douyin | Tải video và kênh Douyin | MIT License | Tác giả jiji262 |
| VieNeu-TTS | TTS tiếng Việt chạy cục bộ và clone giọng | Apache License 2.0 | [pnnbao97/VieNeu-TTS](https://github.com/pnnbao97/VieNeu-TTS) |
| capcut-tts-api | Nhà cung cấp TTS CapCut trực tuyến tùy chọn | Chưa công bố | [K07VN/capcut-tts-api](https://github.com/K07VN/capcut-tts-api) |
| faster-whisper | Nhận dạng giọng nói | MIT License | [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) |
| CTranslate2 | Chạy model nhận dạng giọng nói | MIT License | [OpenNMT/CTranslate2](https://github.com/OpenNMT/CTranslate2) |
| ONNX Runtime | Chạy model dạng ONNX | MIT License | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) |
| Tokenizers | Tách từ cho model nhận dạng | Apache License 2.0 | [huggingface/tokenizers](https://github.com/huggingface/tokenizers) |
| huggingface_hub | Nạp model cục bộ | Apache License 2.0 | [huggingface/huggingface_hub](https://github.com/huggingface/huggingface_hub) |
| PyAV | Đọc và giải mã audio/video | BSD 3-Clause | [PyAV-Org/PyAV](https://github.com/PyAV-Org/PyAV) |
| NumPy | Xử lý dữ liệu số | BSD 3-Clause | [numpy.org](https://numpy.org) |
| Protocol Buffers | Dữ liệu tuần tự hóa | BSD 3-Clause | Google LLC |
| FlatBuffers | Dữ liệu tuần tự hóa | Apache License 2.0 | Google LLC |
| tqdm | Thanh tiến trình nội bộ | MPL-2.0 và MIT License | [tqdm/tqdm](https://github.com/tqdm/tqdm) |
| Whisper | Model nhận dạng giọng nói | MIT License | OpenAI / SYSTRAN |
| pyannote segmentation 3.0 | Phát hiện đoạn có người nói | MIT License | [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0) |
| CAM++ / 3D-Speaker | Phân biệt đặc trưng giọng | Apache License 2.0 | [modelscope/3D-Speaker](https://github.com/modelscope/3D-Speaker) |
| NVIDIA cuBLAS và cuDNN | Tăng tốc GPU NVIDIA | NVIDIA terms | [NVIDIA](https://docs.nvidia.com/cuda/eula/) |

## Công cụ tải và xử lý media

### ffmpeg

- Vai trò: xử lý/ghép âm thanh-video, đổi định dạng và nhúng phụ đề.
- Giấy phép: LGPL / GPL.
- Upstream: [ffmpeg licensing](https://ffmpeg.org/legal.html).
- Được tải về khi cần; LTSKit không chỉnh sửa mã nguồn.

### Bộ tải xuống đa nền tảng

- Vai trò: tải nội dung từ các nền tảng hỗ trợ.
- Giấy phép: The Unlicense, thuộc phạm vi công cộng.

### Bộ tải Douyin

- Vai trò: tải video và kênh từ Douyin không watermark.
- Giấy phép: MIT License.
- Bản quyền: Copyright (c) 2026 jiji262.

## Chuyển văn bản thành giọng nói

### VieNeu-TTS

- Upstream: [pnnbao97/VieNeu-TTS](https://github.com/pnnbao97/VieNeu-TTS).
- Tác giả: Phạm Nguyễn Ngọc Bảo (`pnnbao97`).
- Vai trò: TTS tiếng Việt chạy cục bộ và clone giọng.
- Giấy phép: Apache License 2.0.

### capcut-tts-api

- Upstream: [K07VN/capcut-tts-api](https://github.com/K07VN/capcut-tts-api).
- Tác giả/upstream: K07VN.
- Vai trò: LTSKit chỉ cài package này vào môi trường dữ liệu ứng dụng khi người dùng yêu cầu cài công cụ CapCut.
- Giấy phép: upstream chưa công bố LICENSE tại thời điểm đối chiếu. LTSKit không suy đoán hoặc gán giấy phép cho package này.

## Thư viện nhận dạng và xử lý

### Speech và OCR

- **faster-whisper**: nhận dạng giọng nói; MIT License; bản quyền SYSTRAN.
- **CTranslate2**: động cơ chạy model nhận dạng giọng nói; MIT License; bản quyền OpenNMT.
- **ONNX Runtime**: chạy model ONNX cho nhận dạng văn bản; MIT License; bản quyền Microsoft Corporation.
- **Tokenizers**: tách từ cho model nhận dạng giọng nói; Apache License 2.0; bản quyền Hugging Face.
- **huggingface_hub**: nạp model từ thư mục cục bộ; Apache License 2.0; bản quyền Hugging Face.

### Xử lý dữ liệu và media

- **PyAV**: đọc và giải mã âm thanh từ video; BSD 3-Clause License.
- **NumPy**: xử lý dữ liệu số; BSD 3-Clause License.
- **Protocol Buffers**: dữ liệu tuần tự hóa; BSD 3-Clause License; bản quyền Google LLC.
- **FlatBuffers**: dữ liệu tuần tự hóa; Apache License 2.0; bản quyền Google LLC.
- **tqdm**: thanh tiến trình nội bộ; MPL-2.0 và MIT License.

## Model AI

### Whisper

- Vai trò: nhận dạng giọng nói trong tab Phụ đề.
- Model gốc: `openai/whisper-*`, MIT License, OpenAI.
- Bản chuyển đổi: `Systran/faster-whisper-*`, MIT License, SYSTRAN.
- Model được tải về khi cần.

### pyannote segmentation 3.0

- Vai trò: phát hiện đoạn có người nói để tách người nói.
- Giấy phép: MIT License.
- Bản quyền: Hervé Bredin và cộng sự, dự án pyannote.audio.

### CAM++ / 3D-Speaker

- Vai trò: nhận diện đặc trưng giọng để phân biệt người nói.
- Giấy phép: Apache License 2.0.
- Bản quyền: ModelScope / 3D-Speaker.

## Tăng tốc GPU

### NVIDIA cuBLAS và cuDNN

- Vai trò: tăng tốc nhận dạng giọng nói trên GPU NVIDIA.
- Bản quyền: NVIDIA Corporation.
- Giấy phép: NVIDIA CUDA Toolkit EULA và NVIDIA cuDNN SLA; việc phân phối lại tuân theo điều khoản NVIDIA cho thư viện chạy kèm ứng dụng.

## Ghi chú giấy phép

- [MIT License](https://opensource.org/license/mit/)
- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- [BSD 3-Clause License](https://opensource.org/license/bsd-3-clause/)
- [MPL 2.0](https://www.mozilla.org/MPL/2.0/)
- [ffmpeg licensing](https://ffmpeg.org/legal.html)
- [NVIDIA CUDA EULA](https://docs.nvidia.com/cuda/eula/)
- [NVIDIA cuDNN SLA](https://docs.nvidia.com/deeplearning/cudnn/sla/)

Các thành phần vẫn thuộc bản quyền của tác giả gốc. LTSKit không tuyên bố quyền sở hữu đối với các thành phần bên thứ ba nêu trên.
