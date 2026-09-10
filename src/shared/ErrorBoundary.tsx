import * as React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
  // Omit for the default chip. Pass `null` for a subtree that should just
  // disappear (a decoration whose absence says everything).
  fallback?: React.ReactNode;
  children: React.ReactNode | React.ReactNode[];
  onError?: () => void;
  name?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// Small, in-flow, and dismissible. Every call site used to pass
// `fallback={undefined}`, so a crash anywhere made that subtree vanish
// silently and permanently — no message, and no way back short of a
// reload. Retry is worth having because most of what these boundaries wrap
// is a panel over a map that is still perfectly usable underneath.
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
