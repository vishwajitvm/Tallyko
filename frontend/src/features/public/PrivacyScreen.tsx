import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Text } from '@/components/ui';
import { PublicPage } from './PublicPage';
import { Bullets, Rich } from './RichText';

const LAST_UPDATED = '23 October 2026';

type Block = string | { list: string[] } | { sub: string };
interface Section { id: string; title: string; blocks: Block[] }

const SECTIONS: Section[] = [
  {
    id: 'who', title: '1. Who we are',
    blocks: [
      'Tallyko is a point-of-sale (billing) app for restaurants, cafés, cloud kitchens and retail shops. It is provided by [[Your company name]], [[registered address]] ("we", "us").',
      'This policy explains what information Tallyko handles, why, and the choices you have. It covers the Tallyko apps for Android and iOS, the web app, and the ordering pages that shops share with their customers.',
      'If a business runs Tallyko on its own server (using the "Server address" option at sign-in), that business — not us — operates that server and is responsible for the data stored on it.',
    ],
  },
  {
    id: 'collect', title: '2. Information we collect',
    blocks: [
      { sub: 'Business owners and staff' },
      { list: [
        '**Account details:** name, email address, phone number and your role in the business (owner, manager, cashier, waiter, kitchen).',
        '**Password:** stored only as a one-way encrypted hash. We never see or store your actual password.',
        '**Business details:** business name, type, address, GSTIN and FSSAI numbers, UPI ID and other settings you enter.',
        '**Business records:** your menu or product list, prices, stock levels, tables, orders, invoices, payments received and reports.',
      ] },
      { sub: 'Customers of a shop' },
      { list: [
        'A shop may save its customers\' **names and phone numbers** (and optionally email and notes) for billing, delivery and loyalty points.',
        'When you order from a shop\'s online or QR ordering page, we receive the **name, phone number, delivery address (for deliveries) and order notes** you enter, and pass them to that shop so it can fulfil your order.',
      ] },
      { sub: 'Menu photos' },
      { list: [
        'If you photograph a printed menu to import it, the photo is sent to our server, the text is read automatically (on our own server, without any third-party service) and the **photo is then discarded**. Only the items you choose to save are kept.',
      ] },
      { sub: 'Device and technical data' },
      { list: [
        'We do **not** collect advertising identifiers, location, contacts or any data for tracking you across apps or websites.',
        'Our servers keep short-lived technical logs (IP address, time, the page or feature requested and error details) to keep the service secure and to fix problems.',
        'The app stores your sign-in session securely on your device and keeps a copy of your business data on the device so billing works without internet.',
      ] },
    ],
  },
  {
    id: 'use', title: '3. How we use information',
    blocks: [
      { list: [
        'To provide the service: sign-in, billing, printing receipts and kitchen tickets, table and order management, stock, reports and online ordering.',
        'To pass a customer\'s order details to the shop they ordered from.',
        'To keep accounts secure, for example by limiting repeated sign-in attempts and investigating misuse.',
        'To answer your support requests and to tell you about important changes to the service.',
        'To meet legal obligations, such as keeping tax records.',
      ] },
      'We **do not sell** personal data, we **do not show ads**, and we **do not use third-party analytics or advertising tools**.',
    ],
  },
  {
    id: 'basis', title: '4. Legal basis and roles (India — DPDP Act, 2023)',
    blocks: [
      'We process personal data under India\'s Digital Personal Data Protection Act, 2023 on the basis of the consent you give when you create an account or place an order, and for legitimate uses the Act allows, such as complying with law.',
      'For **owner and staff accounts**, we decide how that data is used and act as the Data Fiduciary.',
      'For **a shop\'s customers**, the shop decides what to collect and why, so **the shop is the Data Fiduciary** and we process that data on its behalf. If you are a customer and want your details corrected or removed, please contact the shop first; we will help the shop respond.',
    ],
  },
  {
    id: 'share', title: '5. Who we share information with',
    blocks: [
      { list: [
        '**The shop you order from** receives your order details.',
        '**Within a business,** staff can see the records their role allows (for example, a cashier sees bills, an owner sees reports).',
        '**Service providers** that host our servers and backups: [[Your hosting provider and data location]]. They may only use the data to provide their service to us.',
        '**Authorities,** when the law requires it (for example a valid request under Indian law).',
      ] },
      'We do not share personal data with advertisers, data brokers or delivery aggregators. Orders a shop receives from aggregators (such as Swiggy or Zomato) contain data that the aggregator shares with the shop under its own policy.',
    ],
  },
  {
    id: 'retention', title: '6. How long we keep information',
    blocks: [
      { list: [
        'Account and business data is kept while the account is active.',
        'When an account is deleted, the person\'s name, email address, phone number and password are erased. When an owner closes a business, every staff login is disabled and customers\' contact details are erased.',
        '**Invoices and sales records** are kept, without the deleted personal details where possible, **for as long as required by tax law** (India\'s GST rules require businesses to keep accounts and invoices for several years).',
        'Technical logs are kept for up to [[number]] days. Backups are overwritten on a rolling schedule within [[number]] days.',
        'Menu photos are deleted as soon as the text has been read.',
      ] },
    ],
  },
  {
    id: 'security', title: '7. How we protect information',
    blocks: [
      { list: [
        'All connections to our servers use encryption in transit (HTTPS).',
        'Passwords are stored only as salted one-way hashes (bcrypt).',
        'Each business\'s data is kept separate: every request is checked against the signed-in business, and the database itself enforces per-business isolation as a second safeguard.',
        'Access is role-based, sign-in attempts are rate-limited, and sign-in sessions on phones and tablets are stored in the device\'s secure storage.',
      ] },
      'No system is perfectly secure. If we learn of a breach affecting your personal data, we will notify you and the Data Protection Board of India as the law requires.',
    ],
  },
  {
    id: 'rights', title: '8. Your rights and deleting your account',
    blocks: [
      'You can ask us for a summary of the personal data we hold about you, ask us to correct or complete it, ask us to erase it, withdraw your consent, and nominate someone to exercise these rights for you. You can also raise a grievance with us, and if you are not satisfied, with the Data Protection Board of India.',
      'You can **delete your account** in the app under **Settings → Account → Delete account**, or on the web at {{/delete-account|our account deletion page}}. If you cannot sign in, email [[support@your-domain]] from the address on your account.',
    ],
  },
  {
    id: 'permissions', title: '9. App permissions',
    blocks: [
      'The app asks for a permission only when you use the feature that needs it. You can turn each one off in your device settings; only that feature stops working.',
      { list: [
        '**Camera:** to scan product barcodes and photograph a printed menu for import.',
        '**Photos:** to choose a menu photo you already have. The system photo picker shares only the photo you pick.',
        '**Bluetooth (nearby devices):** to find and connect to receipt and kitchen printers. It is not used to determine your location.',
        '**Local network:** to reach printers, or a Tallyko server, on your shop\'s Wi-Fi.',
      ] },
      'Tallyko does not request access to your microphone, location, contacts or calendar.',
    ],
  },
  {
    id: 'children', title: '10. Children',
    blocks: [
      'Tallyko is a business tool and is not directed at anyone under 18. We do not knowingly create accounts for children. If you believe a child has given us personal data, contact us and we will delete it.',
    ],
  },
  {
    id: 'changes', title: '11. Changes to this policy',
    blocks: [
      'We may update this policy as the service or the law changes. We will change the "Last updated" date above and, for significant changes, tell account holders in the app or by email before the change takes effect.',
    ],
  },
  {
    id: 'contact', title: '12. Contact and grievance officer',
    blocks: [
      'Questions, requests or complaints about privacy:',
      { list: [
        'Grievance Officer: [[Name]]',
        'Email: [[privacy@your-domain]]',
        'Address: [[Your company name, registered address]]',
      ] },
      'We aim to respond within 7 days and to resolve grievances within the time the law requires.',
    ],
  },
];

const HIGHLIGHTS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { icon: 'eye-off-outline', title: 'No ads or tracking', body: 'No advertising IDs or third-party analytics.' },
  { icon: 'ban-outline', title: 'We never sell data', body: 'Your business data is yours.' },
  { icon: 'lock-closed-outline', title: 'Encrypted & isolated', body: 'HTTPS, hashed passwords, per-business isolation.' },
  { icon: 'trash-outline', title: 'Delete any time', body: 'In the app or on the web.' },
];

function jumpTo(id: string) {
  try {
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  } catch {
    /* not on web */
  }
}

export default function PrivacyScreen() {
  const { colors, radius } = useTheme();
  const { isPhone } = useLayout();

  return (
    <PublicPage title="Privacy policy · Tallyko">
      <View style={{ gap: 8 }}>
        <Text variant="caption" tone="primary" style={{ textTransform: 'uppercase' }}>Legal</Text>
        <Text variant="display" accessibilityRole="header">Privacy policy</Text>
        <Text tone="muted">Last updated {LAST_UPDATED}</Text>
      </View>

      <View style={[styles.highlights, { marginTop: 24 }]}>
        {HIGHLIGHTS.map((h) => (
          <View key={h.title} style={[styles.highlight, { width: isPhone ? '100%' : '48.5%', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg }]}>
            <View style={[styles.highlightIcon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name={h.icon} size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{h.title}</Text>
              <Text variant="small" tone="muted">{h.body}</Text>
            </View>
          </View>
        ))}
      </View>

      {Platform.OS === 'web' ? (
        <View style={[styles.toc, { borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt }]}>
          <Text variant="smallStrong" tone="muted">On this page</Text>
          <View style={styles.tocList}>
            {SECTIONS.map((s) => (
              <Pressable key={s.id} onPress={() => jumpTo(s.id)} accessibilityRole="link" style={[{ width: isPhone ? '100%' : '48%', paddingVertical: 4 }, { cursor: 'pointer' } as any]}>
                <Text variant="small" tone="primary">{s.title}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {SECTIONS.map((section) => (
        <View key={section.id} style={styles.section} nativeID={section.id}>
          <Text variant="h2" accessibilityRole="header">{section.title}</Text>
          {section.blocks.map((block, i) => {
            if (typeof block === 'string') return <Rich key={i}>{block}</Rich>;
            if ('sub' in block) return <Text key={i} variant="h3" style={{ marginTop: 6 }}>{block.sub}</Text>;
            return <Bullets key={i} items={block.list} />;
          })}
        </View>
      ))}

      <View style={[styles.placeholderNote, { backgroundColor: colors.accentSoft, borderRadius: radius.md }]}>
        <Ionicons name="create-outline" size={18} color={colors.accentText} />
        <Text variant="small" color={colors.accentText} style={{ flex: 1 }}>
          Highlighted text marks details the operator of this Tallyko service must fill in before publishing this policy.
        </Text>
      </View>
    </PublicPage>
  );
}

const styles = StyleSheet.create({
  highlights: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  highlight: { flexDirection: 'row', gap: 12, padding: 14, borderWidth: 1, alignItems: 'center' },
  highlightIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  toc: { marginTop: 20, padding: 16, borderWidth: 1, gap: 8 },
  tocList: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4 },
  section: { gap: 12, marginTop: 32 },
  placeholderNote: { flexDirection: 'row', gap: 10, padding: 14, marginTop: 32, alignItems: 'center' },
});
