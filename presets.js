/**
 * SETTINGS DEFINITIONS
 * Each setting maps to a Cloudinary transformation parameter, which is
 * itself a wrapper around an ffmpeg flag. `flag` is shown in the
 * "what this does" panel so the tool doubles as an ffmpeg reference.
 *
 * tier: "basic" | "advanced"  — basic ones always show, advanced-only
 * ones are hidden until Advanced mode is toggled on.
 */

const QUALITY_PRESETS = [
  { value: "", label: "Custom" },
  { value: "web-small", label: "Web — smallest file" },
  { value: "web-balanced", label: "Web — balanced" },
  { value: "web-high", label: "Web — high quality" },
  { value: "archive", label: "Archival — near-lossless" },
  { value: "audio-podcast", label: "Audio — podcast/voice" },
  { value: "audio-music", label: "Audio — music" },
];

// Actual value bundles each preset applies. Anything in "Custom" leaves
// current control values untouched.
const PRESET_VALUES = {
  "web-small":     { quality: 40, videoBitrate: "500", audioBitrate: "96",  scale: "720",  fps: "24" },
  "web-balanced":  { quality: 65, videoBitrate: "1200", audioBitrate: "128", scale: "1080", fps: "" },
  "web-high":      { quality: 80, videoBitrate: "3000", audioBitrate: "192", scale: "",     fps: "" },
  "archive":       { quality: 95, videoBitrate: "8000", audioBitrate: "320", scale: "",     fps: "" },
  "audio-podcast": { quality: 60, audioBitrate: "96", audioSampleRate: "44100" },
  "audio-music":   { quality: 85, audioBitrate: "256", audioSampleRate: "48000" },
};

const SETTINGS_SCHEMA = [
  {
    group: "Format & Preset",
    tier: "basic",
    controls: [
      {
        id: "preset",
        label: "Preset",
        type: "select",
        options: QUALITY_PRESETS,
        default: "web-balanced",
        explain: {
          title: "Preset",
          body: "A bundle of sane defaults for a common goal — small file for messaging, balanced for general web use, high quality for portfolios, or archival for near-lossless masters. Picking one fills in the sliders below; you can still nudge them afterward.",
          flag: "(bundles multiple flags)",
        },
      },
      {
        id: "format",
        label: "Output format",
        type: "select",
        options: [
          { value: "mp4", label: "MP4 (H.264) — most compatible" },
          { value: "webm", label: "WebM (VP9) — smaller, modern browsers" },
          { value: "mov", label: "MOV" },
          { value: "mp3", label: "MP3 (audio only)" },
          { value: "wav", label: "WAV (audio only, uncompressed)" },
          { value: "flac", label: "FLAC (audio only, lossless)" },
          { value: "aac", label: "AAC (audio only)" },
        ],
        default: "mp4",
        explain: {
          title: "Output format / container",
          body: "The container and codec the final file is wrapped in. MP4/H.264 plays everywhere. WebM/VP9 compresses better but is less universally supported by older devices. Audio-only formats strip video entirely.",
          flag: "-c:v libx264 (mp4)  /  -c:v libvpx-vp9 (webm)",
        },
      },
      {
        id: "quality",
        label: "Compression rate",
        type: "range", min: 0, max: 100, step: 1, default: 65, unit: "%",
        explain: {
          title: "Compression rate (quality)",
          body: "Lower values compress harder and shrink the file more, at the cost of visible/audible quality loss. This maps to ffmpeg's CRF (Constant Rate Factor) scale, just inverted and normalized to 0–100 so higher always means better here. 60–75% is a good default for sharing online.",
          flag: "-crf 23  (18 = near-lossless, 28 = visibly soft, 51 = worst)",
        },
      },
    ],
  },
  {
    group: "Video",
    tier: "basic",
    controls: [
      {
        id: "videoBitrate",
        label: "Video bitrate",
        type: "range", min: 100, max: 12000, step: 50, default: 1200, unit: " kbps",
        explain: {
          title: "Video bitrate",
          body: "How much data is spent per second of video. Higher bitrate preserves more detail, especially in motion-heavy or high-contrast footage, but produces a larger file. If both quality and bitrate are set, most encoders treat bitrate as a ceiling.",
          flag: "-b:v 1200k",
        },
      },
      {
        id: "scale",
        label: "Resolution",
        type: "select",
        options: [
          { value: "", label: "Keep original" },
          { value: "2160", label: "2160p (4K)" },
          { value: "1440", label: "1440p (2K)" },
          { value: "1080", label: "1080p" },
          { value: "720", label: "720p" },
          { value: "480", label: "480p" },
          { value: "360", label: "360p" },
        ],
        default: "",
        explain: {
          title: "Resolution / scale",
          body: "Downscaling the frame size is one of the most effective ways to cut file size — a 1080p→720p downscale alone can cut bitrate needs by roughly half for the same visual quality. Only scales down; won't upscale past the source.",
          flag: "-vf scale=-2:720",
        },
      },
    ],
  },
  {
    group: "Audio",
    tier: "basic",
    controls: [
      {
        id: "audioBitrate",
        label: "Audio bitrate",
        type: "select",
        options: [
          { value: "64", label: "64 kbps — voice/podcast" },
          { value: "96", label: "96 kbps" },
          { value: "128", label: "128 kbps — standard" },
          { value: "192", label: "192 kbps" },
          { value: "256", label: "256 kbps — high quality" },
          { value: "320", label: "320 kbps — max MP3" },
          { value: "custom", label: "Custom…" },
        ],
        default: "128",
        allowCustom: true,
        customMin: 8,
        customMax: 512,
        explain: {
          title: "Audio bitrate",
          body: "Data rate for the audio track. 128kbps is transparent for most music on typical speakers/earbuds; 64–96kbps is plenty for spoken word. Note: for video output formats, the video bitrate above takes priority and this control is disabled — it only applies when the output format is audio-only (MP3/WAV/FLAC/AAC).",
          flag: "-b:a 128k",
        },
      },
    ],
  },

  /* ===================== ADVANCED ONLY ===================== */

  {
    group: "Video — Advanced",
    tier: "advanced",
    controls: [
      {
        id: "videoCodec",
        label: "Video codec",
        type: "select",
        options: [
          { value: "auto", label: "Auto (match format)" },
          { value: "h264", label: "H.264 / AVC" },
          { value: "h265", label: "H.265 / HEVC" },
          { value: "vp9", label: "VP9" },
          { value: "vp8", label: "VP8" },
          { value: "av1", label: "AV1" },
        ],
        default: "auto",
        explain: {
          title: "Video codec",
          body: "The compression algorithm used to encode frames. H.265 and AV1 compress noticeably better than H.264 at the same visual quality, but take longer to encode and have less universal playback support. H.264 remains the safest default for compatibility.",
          flag: "-c:v libx265 / -c:v libaom-av1",
        },
      },
      {
        id: "fps",
        label: "Frame rate",
        type: "select",
        options: [
          { value: "", label: "Keep original" },
          { value: "60", label: "60 fps" },
          { value: "30", label: "30 fps" },
          { value: "24", label: "24 fps" },
          { value: "15", label: "15 fps" },
        ],
        default: "",
        explain: {
          title: "Frame rate (fps)",
          body: "Frames rendered per second of video. Halving the frame rate roughly halves the data needed for motion, which is a big lever for screen recordings or talking-head footage where high fps adds little. Don't drop below the source's natural motion needs (e.g. sports).",
          flag: "-r 30",
        },
      },
      {
        id: "keyframeInterval",
        label: "Keyframe interval",
        type: "range", min: 1, max: 300, step: 1, default: 48, unit: " frames",
        explain: {
          title: "Keyframe (GOP) interval",
          body: "How often a full reference frame (rather than a delta from the previous frame) is inserted. Shorter intervals make seeking/scrubbing snappier and improve resilience to dropped frames, but increase file size. Longer intervals compress better for static content.",
          flag: "-g 48",
        },
      },
      {
        id: "bFrames",
        label: "B-frames",
        type: "range", min: 0, max: 16, step: 1, default: 3, unit: "",
        explain: {
          title: "B-frames (bidirectional frames)",
          body: "Frames predicted from both the previous and next frame, which compress very efficiently. More B-frames generally improves compression ratio at the cost of encoding time and slightly higher decode complexity.",
          flag: "-bf 3",
        },
      },
      {
        id: "pixelFormat",
        label: "Pixel format",
        type: "select",
        options: [
          { value: "yuv420p", label: "yuv420p — standard, most compatible" },
          { value: "yuv422p", label: "yuv422p — higher chroma detail" },
          { value: "yuv444p", label: "yuv444p — full chroma, largest" },
        ],
        default: "yuv420p",
        explain: {
          title: "Pixel format / chroma subsampling",
          body: "Controls how much color detail is kept relative to brightness detail. yuv420p is what nearly all consumer video and players expect. Higher-fidelity options matter mainly for content with fine color detail (text overlays, graphics) that will be re-edited later.",
          flag: "-pix_fmt yuv420p",
        },
      },
      {
        id: "twoPass",
        label: "Two-pass encoding",
        type: "toggle",
        default: false,
        explain: {
          title: "Two-pass encoding",
          body: "Encodes the file twice — once to analyze complexity, once to actually compress using that analysis — to hit a target bitrate more accurately and allocate data more intelligently across scenes. Takes roughly twice as long; mainly useful when you have a strict bitrate target rather than a quality target.",
          flag: "-pass 1 / -pass 2",
        },
      },
      {
        id: "deinterlace",
        label: "Deinterlace",
        type: "toggle",
        default: false,
        explain: {
          title: "Deinterlace",
          body: "Converts interlaced source footage (common from older broadcast/camcorder sources, where each frame is woven from two half-resolution fields) into standard progressive frames. Leave off unless you see horizontal comb-like artifacts in motion.",
          flag: "-vf yadif",
        },
      },
    ],
  },
  {
    group: "Audio — Advanced",
    tier: "advanced",
    controls: [
      {
        id: "audioCodec",
        label: "Audio codec",
        type: "select",
        options: [
          { value: "auto", label: "Auto (match format)" },
          { value: "aac", label: "AAC" },
          { value: "mp3", label: "MP3" },
          { value: "opus", label: "Opus" },
          { value: "flac", label: "FLAC (lossless)" },
          { value: "pcm", label: "PCM (uncompressed)" },
        ],
        default: "auto",
        explain: {
          title: "Audio codec",
          body: "Opus is the most efficient lossy codec at low-to-mid bitrates and is well supported in modern browsers. AAC is the safe universal default. FLAC/PCM keep audio lossless/uncompressed for archival at the cost of size.",
          flag: "-c:a libopus",
        },
      },
      {
        id: "audioSampleRate",
        label: "Sample rate",
        type: "select",
        options: [
          { value: "", label: "Keep original" },
          { value: "48000", label: "48 kHz — video standard" },
          { value: "44100", label: "44.1 kHz — CD/music standard" },
          { value: "22050", label: "22.05 kHz — voice, small file" },
        ],
        default: "",
        explain: {
          title: "Sample rate",
          body: "How many times per second the audio waveform is measured. 44.1/48kHz is standard for music and video respectively — human hearing has little to gain above that. Dropping to 22.05kHz saves space and is fine for speech-only content.",
          flag: "-ar 44100",
        },
      },
      {
        id: "audioChannels",
        label: "Channels",
        type: "select",
        options: [
          { value: "", label: "Keep original" },
          { value: "1", label: "Mono" },
          { value: "2", label: "Stereo" },
        ],
        default: "",
        explain: {
          title: "Audio channels",
          body: "Mono halves audio data versus stereo by storing one channel instead of two. Fine for podcasts/voice memos where there's no meaningful stereo separation; keep stereo for music.",
          flag: "-ac 1",
        },
      },
      {
        id: "normalizeAudio",
        label: "Normalize loudness",
        type: "toggle",
        default: false,
        explain: {
          title: "Loudness normalization",
          body: "Automatically adjusts overall volume to a consistent target loudness level, so the output isn't unexpectedly quiet or clipping. Useful when the source was recorded at an inconsistent or very low level.",
          flag: "-af loudnorm",
        },
      },
    ],
  },
  {
    group: "Trim & Crop — Advanced",
    tier: "advanced",
    controls: [
      {
        id: "trimStart",
        label: "Trim start",
        type: "text",
        placeholder: "00:00:00",
        default: "",
        explain: {
          title: "Trim start time",
          body: "Cuts everything before this timestamp from the output. Format as HH:MM:SS. Leave blank to keep the file's original start.",
          flag: "-ss 00:00:10",
        },
      },
      {
        id: "trimEnd",
        label: "Trim end",
        type: "text",
        placeholder: "00:00:00",
        default: "",
        explain: {
          title: "Trim end time",
          body: "Cuts everything after this timestamp. Format as HH:MM:SS. Leave blank to keep the file's original end.",
          flag: "-to 00:01:30",
        },
      },
    ],
  },
  {
    group: "Filters — Advanced",
    tier: "advanced",
    controls: [
      {
        id: "denoise",
        label: "Denoise",
        type: "toggle",
        default: false,
        explain: {
          title: "Denoise filter",
          body: "Smooths out sensor/film grain and compression artifacts before re-encoding. Can improve compression efficiency since noise is expensive to encode, but overly aggressive denoising softens fine detail.",
          flag: "-vf hqdn3d",
        },
      },
      {
        id: "sharpen",
        label: "Sharpen",
        type: "range", min: 0, max: 100, step: 5, default: 0, unit: "%",
        explain: {
          title: "Sharpen filter",
          body: "Boosts edge contrast to counteract softness introduced by downscaling or heavy compression. Use sparingly — overdone sharpening introduces visible haloing around edges.",
          flag: "-vf unsharp",
        },
      },
      {
        id: "stripMetadata",
        label: "Strip metadata",
        type: "toggle",
        default: true,
        explain: {
          title: "Strip metadata",
          body: "Removes embedded metadata such as GPS location, device/camera model, and timestamps from the file. Recommended when sharing publicly, since this metadata can reveal more than intended.",
          flag: "-map_metadata -1",
        },
      },
    ],
  },
];
