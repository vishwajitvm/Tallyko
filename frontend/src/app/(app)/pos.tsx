import React from 'react';
import { PosScreen } from '@/features/pos/PosScreen';

/** Billing / POS. Deep links: /pos?table=<tableId>, /pos?order=<orderId>, /pos?channel=SWIGGY */
export default function PosRoute() {
  return <PosScreen />;
}
