import type { Table } from '@tanstack/react-table';

import { ParagraphSkeleton, TableSkeletonRows, useDesignSystemTheme } from '@databricks/design-system';
import { useIntl } from '@databricks/i18n';

import type { EvalTraceComparisonEntry } from './types';

export const GenAITracesTableBodySkeleton = ({
  className,
  table,
}: {
  className?: string;
  table?: Table<EvalTraceComparisonEntry>;
}) => {
  const intl = useIntl();
  const { theme } = useDesignSystemTheme();
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        backgroundColor: theme.colors.backgroundPrimary,
      }}
      className={className}
    >
      {table ? (
        <TableSkeletonRows
          label={intl.formatMessage({
            defaultMessage: 'Loading...',
            description: 'Accessible label for the skeleton rows shown while the GenAI traces table loads',
          })}
          numRows={3}
          table={table}
        />
      ) : (
        [...Array(10).keys()].map((i) => (
          <ParagraphSkeleton
            label={intl.formatMessage({
              defaultMessage: 'Loading...',
              description: 'Accessible label for the skeleton rows shown while the GenAI traces table loads',
            })}
            key={i}
            seed={`s-${i}`}
          />
        ))
      )}
    </div>
  );
};
