const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#101820"/><path fill="#9cc9ff" d="M8 10h16v3H8zM8 15h12v3H8zM8 20h16v3H8z"/></svg>`;

export function GET() {
  return new Response(iconSvg, {
    headers: {
      "cache-control": "public, max-age=86400",
      "content-type": "image/svg+xml"
    }
  });
}
