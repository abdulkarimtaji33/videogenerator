import fs from "fs";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { withRetry } from "./retry";

const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4.1";
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/** Runs one text generation step. `system` sets the role/task, `user` is the actual instruction. */
export async function generateText(system: string, user: string): Promise<string> {
  const response = await withRetry(() =>
    getClient().chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })
  );

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI text generation returned no content");
  }
  return content.trim();
}

/** Generates a standalone image (used for the character reference shot). Returns PNG bytes. */
export async function generateImage(prompt: string): Promise<Buffer> {
  const response = await withRetry(() =>
    getClient().images.generate({
      model: IMAGE_MODEL,
      prompt,
      size: "1024x1024",
    })
  );

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI image generation returned no image data");
  }
  return Buffer.from(b64, "base64");
}

/**
 * Generates a shot image using the character reference image as identity input,
 * so the character stays visually consistent across shots.
 */
export async function generateImageWithReference(
  prompt: string,
  referenceImagePath: string
): Promise<Buffer> {
  const response = await withRetry(async () => {
    // Re-read the reference file on every attempt: a stream can only be consumed once,
    // so a retried call needs a fresh one.
    const referenceFile = await toFile(
      fs.createReadStream(referenceImagePath),
      "reference.png",
      { type: "image/png" }
    );
    return getClient().images.edit({
      model: IMAGE_MODEL,
      image: referenceFile,
      prompt,
      size: "1024x1024",
    });
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI image edit returned no image data");
  }
  return Buffer.from(b64, "base64");
}
