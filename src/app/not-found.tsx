// #57: Next's built-in 404 page ships an inline <style> without a nonce, which the document CSP blocks.
// This neutral page uses no inline style and names no host, company or reason (TEST-MVP-10).
export default function NotFound() {
  return <main><h1>Nie znaleziono strony</h1></main>;
}
