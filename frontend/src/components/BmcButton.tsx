// The Buy Me a Coffee widget script positions its button via document.currentScript,
// which is null when the script is injected dynamically (as it must be in an SPA), so
// the button never renders. Their static button-image API is reliable and takes the
// same styling params, so we use that wrapped in a link to the profile.
const params = new URLSearchParams({
  text: "Buy me a coffee",
  emoji: "☕",
  slug: "bauk",
  button_colour: "FFDD00",
  font_colour: "000000",
  font_family: "Cookie",
  outline_colour: "000000",
  coffee_colour: "ffffff",
});

export default function BmcButton() {
  return (
    <a href="https://www.buymeacoffee.com/bauk" target="_blank" rel="noreferrer">
      <img
        src={`https://img.buymeacoffee.com/button-api/?${params.toString()}`}
        alt="Buy me a coffee"
        className="h-[48px] w-auto"
      />
    </a>
  );
}
