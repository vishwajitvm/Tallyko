/**
 * Search + filter chips with counts + optional right slot (docs/20_High_Volume_UX.md §2.3–2.4).
 * Search is debounced (300 ms) and `/` focuses it on desktop web.
 *
 *   <FilterBar
 *     onSearch={setQuery}
 *     filters={[{ key: 'running', label: 'Running', count: 12 }, { key: 'ready', label: 'Ready', count: 4 }]}
 *     value={status} onChange={setStatus}
 *     right={<Button title="Today" icon="calendar-outline" variant="outline" onPress={pickRange} />}
 *   />
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleProp, StyleSheet, TextInput, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { useHotkeys } from '@/hooks/useHotkeys';
import { Input } from './Input';
import { Chip } from './Surface';
import { ShortcutHint } from './ShortcutHint';

type IconName = keyof typeof Ionicons.glyphMap;

export interface FilterOption {
  key: string;
  label: string;
  /** A number, or text such as "3/12" or "500+" (shown as is). */
  count?: number | string;
  icon?: IconName;
}

export interface FilterBarProps {
  /** Called with the trimmed query, debounced. */
  onSearch?: (query: string) => void;
  /** Initial/external query. Changing it resets the input. */
  search?: string;
  searchPlaceholder?: string;
  debounceMs?: number;
  /** Key that focuses the search box on web; false to disable. Default "/". */
  searchShortcut?: string | false;
  /** Spinner in the search box while results load. */
  searching?: boolean;
  filters?: FilterOption[];
  /** Selected filter key (single) or keys (multi). */
  value?: string | string[] | null;
  onChange?: (key: string) => void;
  /** Right-side slot, e.g. a date range button. */
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  autoFocus?: boolean;
}

/** Debounce a value: returns it after `ms` without changes. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function FilterBar({
  onSearch, search = '', searchPlaceholder = 'Search', debounceMs = 300, searchShortcut = '/', searching,
  filters, value, onChange, right, style, autoFocus,
}: FilterBarProps) {
  const { colors } = useTheme();
  const { isPhone: phoneWindow } = useLayout();
  // Lay out by the space the bar actually has (a list beside a side panel is narrow even on a wide window)
  const [width, setWidth] = useState(0);
  const isPhone = phoneWindow || (width > 0 && width < 640);
  const onLayout = (e: { nativeEvent: { layout: { width: number } } }) => setWidth(Math.round(e.nativeEvent.layout.width));
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState(search);
  const debounced = useDebounced(text, debounceMs);
  const lastSent = useRef(search.trim());
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  useEffect(() => { setText(search); lastSent.current = search.trim(); }, [search]);
  useEffect(() => {
    const q = debounced.trim();
    if (q === lastSent.current) return;
    lastSent.current = q;
    onSearchRef.current?.(q);
  }, [debounced]);

  useHotkeys(
    searchShortcut ? { [searchShortcut]: () => inputRef.current?.focus() } : {},
    [searchShortcut],
    { enabled: !!onSearch && !!searchShortcut },
  );

  const selected = (key: string) => (Array.isArray(value) ? value.includes(key) : value === key);
  const clear = () => {
    setText('');
    lastSent.current = '';
    onSearchRef.current?.('');
    inputRef.current?.focus();
  };

  const searchBox = onSearch ? (
    <Input
      ref={inputRef}
      icon="search"
      value={text}
      onChangeText={setText}
      placeholder={searchPlaceholder}
      accessibilityLabel={searchPlaceholder}
      autoFocus={autoFocus}
      autoCorrect={false}
      autoCapitalize="none"
      returnKeyType="search"
      onSubmitEditing={() => { const q = text.trim(); lastSent.current = q; onSearchRef.current?.(q); }}
      onKeyPress={(e: any) => { if (Platform.OS === 'web' && e.nativeEvent?.key === 'Escape' && text) { e.preventDefault?.(); clear(); } }}
      containerStyle={isPhone ? styles.searchPhone : styles.searchWide}
      right={
        <View style={styles.searchRight}>
          {searching ? <ActivityIndicator size="small" color={colors.textSubtle} /> : null}
          {text ? (
            <Pressable onPress={clear} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} style={styles.clear}>
              <Ionicons name="close-circle" size={18} color={colors.textSubtle} />
            </Pressable>
          ) : searchShortcut ? <ShortcutHint keys={searchShortcut} /> : null}
        </View>
      }
    />
  ) : null;

  const chips = filters?.length ? (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={isPhone ? styles.chipScrollPhone : styles.chipScroll}
      contentContainerStyle={styles.chips}
      keyboardShouldPersistTaps="handled"
    >
      {filters.map((f) => (
        <Chip key={f.key} label={f.label} count={f.count} icon={f.icon} selected={selected(f.key)} onPress={onChange ? () => onChange(f.key) : undefined} />
      ))}
    </ScrollView>
  ) : null;

  if (isPhone) {
    return (
      <View style={[styles.wrap, style]} onLayout={onLayout}>
        {searchBox || right ? (
          <View style={styles.row}>
            {searchBox}
            {right}
          </View>
        ) : null}
        {chips}
      </View>
    );
  }
  return (
    <View style={[styles.row, style]} onLayout={onLayout}>
      {searchBox}
      {chips ?? <View style={{ flex: 1 }} />}
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchPhone: { flex: 1, minWidth: 0 },
  searchWide: { width: 320, maxWidth: '45%', flexShrink: 1 },
  searchRight: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 10 },
  clear: { padding: 2 },
  // Basis 0: the chips take only the room left by the search box and the right slot (a long chip row scrolls, it never squeezes the search)
  chipScroll: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  chipScrollPhone: { flexGrow: 0 },
  chips: { gap: 8, alignItems: 'center', paddingVertical: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
});
