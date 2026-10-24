import React from 'react';
import Head from 'expo-router/head';

/** Sets the browser tab title (and description) on web; no-op on native. */
export function PageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <Head>
      <title>{title}</title>
      {description ? <meta name="description" content={description} /> : null}
    </Head>
  );
}
