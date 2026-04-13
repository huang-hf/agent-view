import WEB_UI from "./ui.html" with { type: "text" }

export function renderWebAppHtml(): string {
  return WEB_UI as unknown as string
}
