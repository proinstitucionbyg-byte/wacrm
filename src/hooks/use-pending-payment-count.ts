"use client";

import { useEffect, useId, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";

/** The same account-scoped, deduplicated pending total shown in /payments. */
export function usePendingPaymentCount(enabled: boolean): number {
  const { accountId } = useAuth();
  const instanceId = useId().replace(/:/g, '');
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled || !accountId) return;
    const supabase = createClient();
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch('/api/payments?count_only=1', { cache: 'no-store' });
        if (!response.ok) return;
        const result = await response.json();
        if (!cancelled && Number.isSafeInteger(result.total)) setCount(result.total);
      } catch {
        // Keep the last known count until the next reconnect or refresh.
      }
    };

    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => void refresh(), 60_000);
    const channel = supabase.channel(`pending-payment-count-${accountId}-${instanceId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'payment_reviews',
        filter: `account_id=eq.${accountId}`,
      }, () => void refresh())
      .subscribe();

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [enabled, accountId, instanceId]);

  return count;
}
