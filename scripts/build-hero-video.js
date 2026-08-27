const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const sourceRoot = path.resolve(
  process.argv[2] || process.env.HFC_HERO_SOURCE || path.join(os.homedir(), "Downloads", "HFC", "HeroWeb")
);
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const outputRoot = path.join(sourceRoot, "videos");

const variants = [
  {
    name: "desktop",
    width: 1920,
    height: 1080,
    extension: "webp",
    inputDirectory: "1920-webp",
    output: "hfc-hero-racing-1920.mp4",
    crf: "18"
  },
  {
    name: "mobile",
    width: 1280,
    height: 720,
    extension: "webp",
    inputDirectory: "1920-webp",
    output: "hfc-hero-racing-1280.mp4",
    crf: "19"
  }
];

function framePath(variant, frameNumber) {
  return path.join(
    sourceRoot,
    "frames",
    variant.inputDirectory,
    `hfc-hero-frame-${String(frameNumber).padStart(2, "0")}.${variant.extension}`
  );
}

function buildFilter({ width, height }) {
  const interpolate = [
    "minterpolate=fps=30",
    "mi_mode=mci",
    "mc_mode=aobmc",
    "me_mode=bidir",
    "vsbmc=1",
    "scd=none"
  ].join(":");
  const segment = (input, start, end, duration, output) =>
    `[${input}]trim=start_frame=${start}:end_frame=${end},setpts=N/(10*TB),` +
    `tpad=stop_mode=clone:stop_duration=0.2,${interpolate},` +
    `trim=duration=${duration},setpts=PTS-STARTPTS[${output}]`;
  const transition = (left, right, output) =>
    `[${left}][${right}]xfade=transition=fadeblack:duration=0.16:offset=0,` +
    `trim=duration=0.16,setpts=PTS-STARTPTS[${output}]`;

  return [
    `[0:v]scale=${width}:${height},split=4[x1][x2][x3][x4]`,
    segment("x1", 0, 16, 1.6, "s1"),
    segment("x2", 16, 20, 0.4, "s2"),
    segment("x3", 20, 23, 0.3, "s3"),
    segment("x4", 23, 28, 0.5, "s4"),
    `[1:v]scale=${width}:${height},setsar=1[a1]`,
    `[2:v]scale=${width}:${height},setsar=1[b1]`,
    transition("a1", "b1", "t1"),
    `[3:v]scale=${width}:${height},setsar=1[a2]`,
    `[4:v]scale=${width}:${height},setsar=1[b2]`,
    transition("a2", "b2", "t2"),
    `[5:v]scale=${width}:${height},setsar=1[a3]`,
    `[6:v]scale=${width}:${height},setsar=1[b3]`,
    transition("a3", "b3", "t3"),
    "[s1][t1][s2][t2][s3][t3][s4]concat=n=7:v=1:a=0,format=yuv420p[v]"
  ].join(";");
}

function buildVariant(variant) {
  const inputPattern = path.join(
    sourceRoot,
    "frames",
    variant.inputDirectory,
    `hfc-hero-frame-%02d.${variant.extension}`
  );
  const requiredFrames = [16, 17, 20, 21, 23, 24];
  const missing = [inputPattern.replace("%02d", "01"), ...requiredFrames.map((frame) => framePath(variant, frame))]
    .filter((filePath) => !fs.existsSync(filePath));
  if (missing.length) throw new Error(`Faltan frames para ${variant.name}: ${missing.join(", ")}`);

  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "warning",
    "-framerate",
    "10",
    "-start_number",
    "1",
    "-i",
    inputPattern
  ];

  requiredFrames.forEach((frame) => {
    args.push("-loop", "1", "-framerate", "30", "-t", "0.25", "-i", framePath(variant, frame));
  });

  const outputPath = path.join(outputRoot, variant.output);
  args.push(
    "-filter_complex",
    buildFilter(variant),
    "-map",
    "[v]",
    "-an",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    variant.crf,
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-g",
    "30",
    "-movflags",
    "+faststart",
    outputPath
  );

  const result = spawnSync(ffmpeg, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FFmpeg fallo al construir la variante ${variant.name}`);
  const bytes = fs.statSync(outputPath).size;
  console.log(`${variant.name}: ${outputPath} (${bytes} bytes)`);
}

if (!fs.existsSync(sourceRoot)) throw new Error(`No existe el paquete del hero: ${sourceRoot}`);
fs.mkdirSync(outputRoot, { recursive: true });
variants.forEach(buildVariant);
