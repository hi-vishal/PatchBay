import { Loader2 } from 'lucide-react';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { PageContainer, PageHeader } from '@/components/PageStates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { signedIn } from '@/features/auth/authSlice';
import { AiModelSettings } from '@/features/llm/AiModelSettings';
import type { Theme } from '@/features/ui/uiSlice';
import { themeChanged } from '@/features/ui/uiSlice';
import { api, apiErrorMessage } from '@/lib/api';
import { signOutUser } from '@/lib/auth';

const SECTION = 'panel space-y-4 p-5 sm:p-6';
const HEADING = 'font-display text-xl font-semibold';

export default function Settings() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const theme = useAppSelector((state) => state.ui.theme);
  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const result = await dispatch(api.endpoints.syncUser.initiate({ name }));
    setSaving(false);
    if ('data' in result && result.data) {
      dispatch(signedIn(result.data.user));
      toast.success('Name saved');
    } else {
      toast.error(apiErrorMessage(result.error));
    }
  };

  return (
    <PageContainer className="max-w-2xl">
      <PageHeader title="Settings" />

      <section className={SECTION}>
        <h2 className={HEADING}>Profile</h2>
        <form onSubmit={(event) => void saveName(event)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="settings-name">Name</Label>
            <Input
              id="settings-name"
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-email">Email</Label>
            <Input id="settings-email" value={user?.email ?? ''} disabled />
          </div>
          <Button type="submit" disabled={saving || name === user?.name}>
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Save name
          </Button>
        </form>
      </section>

      <AiModelSettings />

      <section className={SECTION}>
        <h2 className={HEADING}>Appearance</h2>
        <div className="space-y-2">
          <Label htmlFor="settings-theme">Theme</Label>
          <Select value={theme} onValueChange={(value) => dispatch(themeChanged(value as Theme))}>
            <SelectTrigger id="settings-theme" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">Match my system</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className={SECTION}>
        <h2 className={HEADING}>Plan</h2>
        <p className="text-muted-foreground">
          You are on the <span className="font-medium capitalize">{user?.plan}</span> plan.
        </p>
        <Button asChild variant="outline">
          <Link to="/app/billing">Manage billing</Link>
        </Button>
      </section>

      <section className={SECTION}>
        <h2 className={HEADING}>Session</h2>
        <Button variant="outline" onClick={() => void signOutUser()}>
          Sign out
        </Button>
      </section>
    </PageContainer>
  );
}
