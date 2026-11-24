export interface ClipRequest {
  planId: string;
  clipId: string;
  prompt: string;
  seconds: number;
  aspect: "9:16" | "16:9";
  referenceImage?: string;
  /** storage/shorts/<planId> */
  runDir: string;
  model?: string;
}

export interface ClipResult {
  file: string;
  provider: string;
  meta?: Record<string, unknown>;
}

export interface ProviderStatus {
  ok: boolean;
  reason?: string;
}

export interface ClipProvider {
  id: string;
  label: string;
  /** "browser" providers are driven by a person or Claude in Chrome through a job pack; "api" providers are called directly. */
  kind: "browser" | "api";
  /** True when the provider runs by itself (an API, or a browser worker). A "browser" provider that is not automatic waits for a person to do the clicks (job pack). */
  automatic?(): boolean;
  status(): ProviderStatus;
  /** Units this request would spend from the provider's daily quota (credits, clips or dollars). */
  cost(req: ClipRequest): number;
  generateClip(req: ClipRequest): Promise<ClipResult>;
}

export interface ImageRequest {
  prompt: string;
  /** Optional reference image path so a character or style stays consistent. */
  referenceImage?: string;
  /** Several reference images (anchors that must all appear). Takes precedence over `referenceImage`. */
  referenceImages?: string[];
  aspect?: "9:16" | "16:9" | "1:1";
}

export interface ImageProvider {
  id: string;
  label: string;
  status(): ProviderStatus;
  generateImage(req: ImageRequest): Promise<Buffer>;
}

export interface TtsRequest {
  text: string;
  outFile: string;
  voice: string;
  model: string;
  instructions: string;
  speed: number;
}

export interface TtsProvider {
  id: string;
  label: string;
  status(): ProviderStatus;
  synthesize(req: TtsRequest): Promise<void>;
}
