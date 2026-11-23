// Kept free of Firebase so it can be tested.

// Turns any common YouTube address into the standard one, or null if it isn't a YouTube video.
export function youtubeUrl(input: string): string | null {
  const s = input.trim();
  const m =
    s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)([\w-]{11})/) ??
    s.match(/^(?:https?:\/\/)?youtu\.be\/([\w-]{11})/);
  return m ? `https://www.youtube.com/watch?v=${m[1]}` : null;
}
