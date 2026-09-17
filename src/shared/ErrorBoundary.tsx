import * as React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
  // Omit for the default chip; `null` for a subtree that should vanish.
  fallback?: React.ReactNode;
  children: React.ReactNode | React.ReactNode[];
  onError?: () => void;
  name?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// Small, in-flow and dismissible, with a retry: what these boundaries wrap
// is usually a panel over a map that is still usable underneath.
const DefaultFallback = ({
  name,
  onRetry,
}: {
  name?: string;
  onRetry: () => void;
}) => {
  const { t } = useTranslation();
  return (
    <div className={styles.fallback} role="alert">
      <span>
        {t('shared.errorBoundary.title')}
        {name ? ` (${name})` : ''}
      </span>
      <button type="button" className={styles.retry} onClick={onRetry}>
        {t('shared.errorBoundary.retry')}
      </button>
    </div>
  );
};

class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    if (this.props.onError) {
      this.props.onError();
    }
    console.error(
      `Error caught in ErrorBoundary${this.props.name ? ` (${this.props.name})` : ''}:`,
      error,
      info,
    );
  }

  retry = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      return this.props.fallback !== undefined ? (
        this.props.fallback
      ) : (
        <DefaultFallback name={this.props.name} onRetry={this.retry} />
      );
    }

    return this.props.children;
  }
}

export { ErrorBoundary };
