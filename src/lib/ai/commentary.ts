import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { SYSTEM_PROMPT } from "./context";

export const COMMENTARY_MODEL = "claude-opus-5-5";
import { COMMENTARY_SECTIONS, type CommentarySection } from "./sections";

export { COMMENTARY_SECTIONS, type CommentarySection };

const Schema = z.object(Object.fromEntries(COMMENTARY_SECTIONS.map((s) => [s, z.string()])) as Record<CommentarySection, z.ZodString>);

export class CommentaryError extends Error {}

export async function writeCommentary(context: unknown, sections: CommentarySection[] = [...COMMENTARY_SECTIONS]): Promise<Partial<Record<CommentarySection, string>>> {
  if (!process.env.ANTHROPIC_API_KEY) throw new CommentaryError("AI commentary is not configured: add ANTHROPIC_API_KEY to the server environment.");
  // Stay inside the route's 60s function limit (Vercel Hobby cap).
  const client = new Anthropic({ timeout: 55_000, maxRetries: 0 });
  try {
    const response = await client.beta.messages.parse({
      model: COMMENTARY_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(Schema) },
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Write commentary for these sections: ${sections.join(", ")}. Return an empty string for any section not in that list.\n\nReport data (JSON):\n${JSON.stringify(context)}`,
      }],
    });
    if (response.stop_reason === "refusal") throw new CommentaryError("The AI declined to write commentary for this data.");
    if (response.stop_reason === "max_tokens") throw new CommentaryError("The AI response was cut off. Try fewer sections at once.");
    const out = response.parsed_output;
    if (!out) throw new CommentaryError("The AI response could not be read. Please try again.");
    return Object.fromEntries(sections.map((s) => [s, out[s].trim()]).filter(([, v]) => v));
  } catch (e) {
    if (e instanceof CommentaryError) throw e;
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new CommentaryError("The AI took too long. Try fewer sections at once.");
    if (e instanceof Anthropic.AuthenticationError) throw new CommentaryError("The Claude API key on the server is invalid.");
    if (e instanceof Anthropic.RateLimitError) throw new CommentaryError("The AI service is busy (rate limited). Try again in a minute.");
    if (e instanceof Anthropic.BadRequestError) throw new CommentaryError(`The AI request was rejected: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new CommentaryError(`The AI service returned an error (${e.status}). Try again shortly.`);
    if (e instanceof Anthropic.APIConnectionError) throw new CommentaryError("Could not reach the AI service. Try again shortly.");
    throw e;
  }
}
