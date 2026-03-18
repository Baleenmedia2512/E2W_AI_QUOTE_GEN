import React from 'react';
import './LoadingSpinner.css';

interface LoadingSpinnerProps {
  size?: 'small' | 'medium' | 'large';
  message?: string;
  fullScreen?: boolean;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'medium',
  message,
  fullScreen = false
}) => {
  const sizeMap = {
    small: 24,
    medium: 48,
    large: 64
  };

  const spinnerSize = sizeMap[size];

  const spinner = (
    <div className={`loading-spinner ${size}`}>
      <div
        className="spinner"
        style={{
          width: `${spinnerSize}px`,
          height: `${spinnerSize}px`
        }}
      ></div>
      {message && <p className="loading-message">{message}</p>}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="loading-fullscreen">
        {spinner}
      </div>
    );
  }

  return spinner;
};
