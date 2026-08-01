# Cloud OCR Notebook and ROI Transfer Design

## Goal

Provide a standalone Jupyter notebook that runs the existing screen-text OCR pipeline on Google Colab or Kaggle, using either CUDA or CPU. Make the local application display and copy the exact source-video ROI coordinates needed by the notebook.

The notebook is an alternative execution path. This work does not change the local OCR algorithm or replace the local OCR engine.

## User Workflow

1. Select a video and draw the OCR region in LTSKit as usual.
2. Click `Sao chep toa do` beside the displayed ROI coordinates.
3. Open the cloud notebook and set `VIDEO_PATH` and `OUTPUT_PATH`.
4. Paste the copied `X0`, `X1`, `Y0`, and `Y1` assignments into the configuration cell.
5. Run all notebook cells.
6. Download or otherwise retrieve the generated SRT file.

The copied text uses Python assignments so it can be pasted directly into the notebook:

```python
X0 = 120
X1 = 1800
Y0 = 760
Y1 = 1030
```

These values are integer pixels in the original video coordinate system, not preview coordinates.

## Notebook Location and Structure

Add a self-contained notebook at:

```text
engines/ocr-engine/ocr-cloud.ipynb
```

The notebook contains the following sections:

1. Environment information and supported platforms.
2. Dependency installation.
3. User configuration.
4. OCR pipeline implementation.
5. Pipeline execution and result summary.

The notebook remains self-contained rather than downloading `engine.py` from the repository. This avoids dependence on repository visibility, branch names, network access after the video is available, and source-version drift during a run. A pipeline version constant near the top of the notebook will make future synchronization explicit.

## Configuration Contract

The user-facing configuration cell defines:

```python
VIDEO_PATH = "/content/video.mp4"
OUTPUT_PATH = "/content/video.srt"
X0 = 120
X1 = 1800
Y0 = 760
Y1 = 1030
FPS = 2
```

`VIDEO_PATH` is the primary input mechanism. It supports:

- Files uploaded into a Colab session, such as `/content/video.mp4`.
- Files mounted from Google Drive.
- Kaggle Dataset files under `/kaggle/input/...`.
- Files already present in the notebook runtime.

The notebook does not implement a platform-specific upload widget. Colab and Kaggle users may use their normal file or dataset workflows without coupling the OCR implementation to one platform.

When `OUTPUT_PATH` is empty, the notebook derives it by replacing the input extension with `.srt` in the runtime working directory. Parent directories are created when possible.

## Compute Device Selection

The notebook automatically selects its ONNX Runtime execution provider:

1. Use `CUDAExecutionProvider` when it is available and RapidOCR can initialize with CUDA.
2. Otherwise use `CPUExecutionProvider`.
3. Display the actual selected device before processing begins.

CUDA initialization failure must not leave the run in an ambiguous state. The notebook reports the failure reason, falls back to CPU, and reports the fallback. DirectML is not used because Colab and Kaggle run Linux environments and provide NVIDIA CUDA GPUs when GPU acceleration is available.

CPU execution remains a supported path. The notebook must not require a GPU runtime.

## OCR Pipeline

The cloud notebook preserves the current local algorithm and its quality-related choices:

1. FFmpeg extracts JPEG frames at the configured FPS.
2. OpenCV reads the selected source-video ROI from each frame.
3. A white-pixel HSV mask and Jaccard distance identify text changes.
4. The most stable frame is selected for each segment.
5. RapidOCR processes the full selected frame.
6. OCR boxes are filtered against the ROI using the existing confidence threshold.
7. Consecutive identical and near-identical cues are merged.
8. The final cues are written as UTF-8 SRT.

The notebook must not resize frames, reduce OCR resolution, or OCR only a narrow cropped strip. These changes could alter recognition quality and are outside this feature's scope.

The initial notebook may duplicate the pipeline implementation from `engine.py`. Functions should keep recognizable names and boundaries so differences can be reviewed when either implementation changes. The notebook displays its pipeline version and the repository should test important behavioral contracts shared by both paths.

## Progress and Metrics

The notebook reports progress for these phases:

- Dependency and device initialization.
- Frame extraction.
- Frame scanning and segmentation.
- OCR inference, including current segment count and recognized text.
- SRT finalization.

The final summary includes:

- Actual compute device.
- Number of extracted frames.
- Number of detected segments.
- Number of OCR inference calls.
- Number of final SRT cues.
- Model initialization time.
- Frame extraction time.
- Segmentation time.
- OCR inference time.
- Total pipeline time.
- Output path.

These metrics make it possible to compare Colab, Kaggle, and local performance using the same video without changing recognition behavior.

## Validation and Errors

Before extracting all frames, the notebook probes or reads the video dimensions and validates:

- `VIDEO_PATH` exists and is a file.
- The video can be opened and has positive width and height.
- ROI values are finite integers.
- `0 <= X0 < X1 <= video_width`.
- `0 <= Y0 < Y1 <= video_height`.
- `FPS` is a positive integer.
- The output parent can be created or written.

Invalid input stops before expensive processing and displays a specific correction message. The notebook must not silently clamp a pasted ROI because that could hide a mismatch between the local video and the cloud video.

FFmpeg or OCR errors include the current phase and a concise underlying error. Temporary frames are cleaned up after success or failure.

If OCR completes with zero cues, the notebook creates an empty SRT and displays a warning to verify the ROI, subtitle color, FPS, and selected video. A zero-cue result is not presented as an ordinary successful recognition result.

## Local ROI UI

The existing coordinate display in `ScreenText` remains the source of truth. Add a `Sao chep toa do` button next to it.

The button copies the current region in this exact order and format:

```python
X0 = <left>
X1 = <right>
Y0 = <top>
Y1 = <bottom>
```

The values come directly from `ocrRegion`, which already contains source-video pixels after preview-to-video conversion. The copy operation does not recompute or scale them.

After a successful copy, the UI shows short confirmation text. If clipboard access fails, it displays a concise error instead of claiming success. Copying is available after video metadata and a valid region exist; it does not require the local OCR engine to be running.

No file export, cloud credentials, upload integration, or automatic notebook launch is included.

## Testing

Automated coverage should verify:

- ROI text formatting uses `X0`, `X1`, `Y0`, `Y1` in the documented order.
- The local button copies current source-video values without scaling.
- Clipboard success and failure states are handled.
- Notebook JSON is valid and contains the required ordered sections.
- The notebook exposes the documented configuration variables.
- Device selection prefers CUDA and falls back to CPU.
- ROI validation rejects empty, inverted, negative, non-integer, and out-of-bounds regions.
- SRT formatting and near-duplicate cue merging match the local engine's tested behavior.
- Zero-cue completion creates an empty SRT and emits a warning.

Notebook source-contract tests can inspect code cells without requiring CUDA or downloading large OCR dependencies in the normal unit suite. A separate manual smoke test should run a small fixture video once on Colab CPU, Colab GPU, Kaggle CPU, and Kaggle GPU when available.

## Acceptance Criteria

- The notebook opens and runs from top to bottom on current Colab and Kaggle runtimes.
- It works without GPU and automatically uses CUDA when a compatible GPU runtime is available.
- Given the same video, FPS, and ROI, it follows the same recognition pipeline as the local engine and produces a valid SRT.
- The local app displays source-video ROI values and copies paste-ready Python assignments.
- Invalid ROI or video paths fail before full frame extraction with an actionable message.
- The notebook reports actual device, recognized text progress, output location, and phase timing metrics.

## Out of Scope

- Using Colab or Kaggle as a permanent API backend for LTSKit.
- Uploading videos from LTSKit to a cloud service.
- Synchronizing cloud progress back into the desktop UI.
- Pause/resume or durable OCR checkpoints.
- Changing local OCR performance, segmentation accuracy, FPS defaults, or cancellation behavior.
- Translating the generated SRT with Gemini inside the notebook.
