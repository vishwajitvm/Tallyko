export { Text, toneColor, type TextTone } from './Text';
export { Button, IconButton, buttonPalette, type ButtonVariant, type ButtonSize, type ButtonProps } from './Button';
export { Input } from './Input';
export { Card, Badge, Chip, Segmented, Divider, EmptyState, ErrorState, Loading, Stat, ListRow, SwitchRow, VegMark, SectionTitle, type BadgeTone } from './Surface';
export { Sheet, toast, ToastHost, confirm, prompt, DialogHost } from './Overlay';
export { Screen } from './Screen';

// High-volume building blocks (docs/20_High_Volume_UX.md §5, §7)
export { ActionMenu, estimateMenuHeight, type ActionMenuHandle, type ActionMenuItem, type ActionMenuProps } from './ActionMenu';
export { SelectionBar, type SelectionAction, type SelectionBarProps } from './SelectionBar';
export { DataList, type DataColumn, type DataListProps, type DataListDensity, type DataListSort } from './DataList';
export { FilterBar, useDebounced, type FilterOption, type FilterBarProps } from './FilterBar';
export {
  StatusPill, statusMeta, statusToneColors, STATUS_META,
  type StatusMeta, type StatusTone, type KnownStatus, type KitchenStatus, type OrderStatus, type PaymentStatus, type SubscriptionStatus,
} from './StatusPill';
export { ShortcutHint, useShowShortcuts } from './ShortcutHint';
export { Checkbox, Skeleton } from './Checkbox';
export { computePopoverPosition, type PopoverPosition, type Rect } from './popover';
export { useHotkeys, formatShortcut, type HotkeyMap, type HotkeyBinding, type HotkeyHandler } from '@/hooks/useHotkeys';
