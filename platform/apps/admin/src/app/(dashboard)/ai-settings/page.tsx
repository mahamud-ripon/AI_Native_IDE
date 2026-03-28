'use client';

import { DashboardLayout } from '@/components/layout';
import { AISettingsPanel } from './AISettingsPanel';
import { useEffect, useState } from 'react';

export default function AISettingsPage() {
  const [user, setUser] = useState(null);

  return (
    <DashboardLayout title="AI Settings" user={user}>
      <AISettingsPanel />
    </DashboardLayout>
  );
}
