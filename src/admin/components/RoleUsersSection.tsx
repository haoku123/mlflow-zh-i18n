import { useMemo, useState } from 'react';
import {
  DialogCombobox,
  DialogComboboxContent,
  DialogComboboxOptionList,
  DialogComboboxOptionListCheckboxItem,
  DialogComboboxOptionListSearch,
  DialogComboboxTrigger,
  Spinner,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FieldLabel } from './FieldLabel';
import { useUsersQuery } from '../hooks';
import { FormattedMessage, useIntl } from '@databricks/i18n';

export interface RoleUsersSectionProps {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  /** Workspace whose roster to offer; defaults to the active workspace. */
  workspace?: string;
}

/**
 * Multi-select picker for assigning users to a role. Mirrors
 * ``RoleAssignmentForm`` (the role multi-select used in user creation
 * + access editing) so the experience is consistent across role
 * creation and role editing.
 */
export const RoleUsersSection = ({ value, onChange, disabled, workspace }: RoleUsersSectionProps) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const [search, setSearch] = useState('');
  const { data: usersData, isLoading } = useUsersQuery(workspace);
  const users = useMemo(() => usersData?.users ?? [], [usersData]);

  const sortedUsers = useMemo(() => [...users].sort((a, b) => a.username.localeCompare(b.username)), [users]);

  const filteredUsers = useMemo(() => {
    const trimmed = search.trim().toLowerCase();
    if (!trimmed) return sortedUsers;
    return sortedUsers.filter((u) => u.username.toLowerCase().includes(trimmed));
  }, [sortedUsers, search]);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const triggerText = useMemo(() => {
    if (value.length === 0) return '';
    if (value.length === 1) return value[0];
    return intl.formatMessage(
      { defaultMessage: '{count} users selected', description: 'Summary label for a multi-user selection' },
      { count: value.length },
    );
  }, [value, intl]);

  // ``DialogCombobox`` calls ``renderDisplayedValue`` once per entry in
  // ``value`` (joined by ``,``); collapse to a single summary label so the
  // count text renders once. Items' checked state is driven by each
  // ``DialogComboboxOptionListCheckboxItem``'s explicit ``checked`` prop —
  // pinned by ``RoleUsersSection.test.tsx``.
  const triggerValue = useMemo(() => (triggerText ? [triggerText] : []), [triggerText]);

  const toggleUser = (username: string) => {
    if (selectedSet.has(username)) {
      onChange(value.filter((u) => u !== username));
    } else {
      onChange([...value, username]);
    }
  };

  return (
    <div>
      <FieldLabel>
        <FormattedMessage defaultMessage="Users" description="Label for the user multi-select field" />
      </FieldLabel>
      {isLoading ? (
        <div css={{ padding: theme.spacing.sm }}>
          <Spinner size="small" />
        </div>
      ) : users.length === 0 ? (
        <Typography.Text color="secondary">
          <FormattedMessage defaultMessage="No users available." description="Empty state for the user list" />
        </Typography.Text>
      ) : (
        <DialogCombobox
          componentId="admin.role_users.users"
          label={intl.formatMessage({ defaultMessage: 'Users', description: 'Label for the user multi-select field' })}
          multiSelect
          value={triggerValue}
        >
          <DialogComboboxTrigger
            withInlineLabel={false}
            placeholder={intl.formatMessage({
              defaultMessage: 'Select one or more users',
              description: 'Placeholder for the user multi-select',
            })}
            onClear={() => onChange([])}
            width="100%"
            disabled={disabled}
          />
          <DialogComboboxContent style={{ zIndex: theme.options.zIndexBase + 100 }}>
            <DialogComboboxOptionList>
              <DialogComboboxOptionListSearch controlledValue={search} setControlledValue={setSearch}>
                {filteredUsers.length === 0 ? (
                  <DialogComboboxOptionListCheckboxItem value="" checked={false} onChange={() => {}} disabled>
                    {search
                      ? intl.formatMessage({
                          defaultMessage: 'No matching users',
                          description: 'Shown when the user search yields no results',
                        })
                      : intl.formatMessage({
                          defaultMessage: 'No users available',
                          description: 'Shown when there are no users to select',
                        })}
                  </DialogComboboxOptionListCheckboxItem>
                ) : (
                  filteredUsers.map((user) => (
                    <DialogComboboxOptionListCheckboxItem
                      key={user.username}
                      value={user.username}
                      checked={selectedSet.has(user.username)}
                      onChange={() => toggleUser(user.username)}
                    />
                  ))
                )}
              </DialogComboboxOptionListSearch>
            </DialogComboboxOptionList>
          </DialogComboboxContent>
        </DialogCombobox>
      )}
    </div>
  );
};
