import React from 'react';
import './AppBootLoader.css';

interface AppBootLoaderProps {
  title?: string;
  subtitle?: string;
  /** Full-viewport shell (SPA boot) vs inset overlay */
  fullScreen?: boolean;
}

/**
 * Branded boot / wait loader — used by Next SpaHost and preview company sync wait.
 */
export const AppBootLoader: React.FC<AppBootLoaderProps> = ({
  title = 'Loading Quote Buddy…',
  subtitle = 'Getting things ready',
  fullScreen = true,
}) => (
  <div
    className={`qb-boot-loader${fullScreen ? ' qb-boot-loader--full' : ''}`}
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <div className="qb-boot-loader__card">
      <div className="qb-boot-loader__orb" aria-hidden="true">
        <span className="qb-boot-loader__ring qb-boot-loader__ring--outer" />
        <span className="qb-boot-loader__ring qb-boot-loader__ring--mid" />
        <span className="qb-boot-loader__ring qb-boot-loader__ring--inner" />
        <span className="qb-boot-loader__core">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5H7z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M14 3.5V8h4.8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M9 12.5h6M9 15.5h6M9 18h3.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </div>
      <p className="qb-boot-loader__title">{title}</p>
      <p className="qb-boot-loader__subtitle">{subtitle}</p>
      <div className="qb-boot-loader__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  </div>
);

export default AppBootLoader;
