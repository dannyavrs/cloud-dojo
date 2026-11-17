import { DISCLAIMER } from '@shared/disclaimer'

/** One quiet line; the full trademark disclaimer opens above it and is also on the About page. */
export function Footer() {
  return (
    <footer className="sitefoot">
      <details>
        <summary>Independent open-source project, not affiliated with Amazon Web Services <span className="sitefoot-more">Trademark notice</span></summary>
        <p className="sitefoot-text">{DISCLAIMER} <a href="#/about">About, credits and emulator gaps</a></p>
      </details>
    </footer>
  )
}
