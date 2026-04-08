#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const path = require("path");
const {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
} = require("@spotify/basic-pitch");

const ONSET_THRESHOLD = 0.25;
const FRAME_THRESHOLD = 0.25;
const MIN_NOTE_LENGTH = 5;

function readPackageMetadata() {
  const packagePath = require.resolve("@spotify/basic-pitch/package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  return {
    versionLabel: `basic-pitch-ts-v${packageJson.version}`,
    modelDir: path.join(path.dirname(packagePath), "model"),
  };
}

async function startModelServer(modelDir) {
  const server = http.createServer((request, response) => {
    const requestedName = (request.url || "/model.json").replace(/^\/+/, "");
    const filePath = path.join(modelDir, requestedName || "model.json");

    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.statusCode = 404;
        response.end("not found");
        return;
      }

      if (filePath.endsWith(".json")) {
        response.setHeader("Content-Type", "application/json");
      } else if (filePath.endsWith(".bin")) {
        response.setHeader("Content-Type", "application/octet-stream");
      }

      response.end(data);
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine Basic Pitch model server address.");
  }

  return {
    server,
    modelUrl: `http://127.0.0.1:${address.port}/model.json`,
  };
}

function loadFloat32Samples(inputPath) {
  const raw = fs.readFileSync(inputPath);
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Usage: basic_pitch_transcribe.cjs <float32-audio-path>");
  }

  const { versionLabel, modelDir } = readPackageMetadata();
  const { server, modelUrl } = await startModelServer(modelDir);

  try {
    const audio = loadFloat32Samples(inputPath);
    const basicPitch = new BasicPitch(modelUrl);
    const frames = [];
    const onsets = [];
    const contours = [];

    await basicPitch.evaluateModel(
      audio,
      (frameBatch, onsetBatch, contourBatch) => {
        frames.push(...frameBatch);
        onsets.push(...onsetBatch);
        contours.push(...contourBatch);
      },
      () => {},
    );

    const noteEvents = outputToNotesPoly(
      frames,
      onsets,
      ONSET_THRESHOLD,
      FRAME_THRESHOLD,
      MIN_NOTE_LENGTH,
    );
    const timedNotes = noteFramesToTime(addPitchBendsToNoteEvents(contours, noteEvents));

    process.stdout.write(
      JSON.stringify({
        modelVersion: versionLabel,
        sampleRate: 22050,
        notes: timedNotes,
      }),
    );
  } finally {
    server.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
