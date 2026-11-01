import { useState } from 'react';
import { CloudAlert, CloudCheck, CloudSync } from 'lucide-react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import {
  GOOGLE_CLIENT_ID,
  allowDataSending,
  connectDrive,
  disconnectDrive,
  reconnectDrive,
  redirectUri,
  syncNow,
  useDriveSync,
} from './drive';

/**
 * Whether to offer Drive sync: in builds with a client ID, and in dev builds
 * without, to tell how to set one up.
 */
export const isDriveSyncOffered = Boolean(GOOGLE_CLIENT_ID) || import.meta.env.DEV;

/** Turns Drive sync on or off, and tells how it's going. */
export function DriveSyncDialog({ onClose }: { onClose: () => void }) {
  const sync = useDriveSync();
  // Why connecting or signing in again failed, if it did
  const [problem, setProblem] = useState<string>();

  const connect = async () => {
    setProblem(undefined);
    try {
      await connectDrive();
    } catch (err) {
      console.warn(err);
      setProblem(err instanceof Error ? err.message : String(err));
    }
  };

  const reconnect = async () => {
    setProblem(undefined);
    try {
      await reconnectDrive();
    } catch (err) {
      console.warn(err);
      setProblem(err instanceof Error ? err.message : String(err));
    }
  };

  let content: React.ReactNode;
  let actions: React.ReactNode;
  if (!GOOGLE_CLIENT_ID) {
    content = (
      <Banner
        status="warning"
        title="Google Drive sync isn't set up in this build"
        description={
          <VStack gap={2}>
            <Text>
              Set WXT_GOOGLE_CLIENT_ID in .env to an OAuth client ID that lists this redirect URI:
            </Text>
            <Text type="code">{redirectUri()}</Text>
          </VStack>
        }
      />
    );
    actions = <Button label="Close" variant="primary" onClick={onClose} />;
  } else if (!sync.isOn) {
    content = (
      <VStack gap={3}>
        <Text as="p">
          Keeps your groups the same in every browser where you turn this on with the same Google
          account, Chrome and Firefox alike. yt3k keeps them in a hidden folder in your Google Drive
          that only it can see.
        </Text>
        <Text as="p">
          Groups here and in Drive are merged the first time, so none are lost: groups of the same
          name become one.
        </Text>
        {problem && (
          <Banner status="error" title="Couldn't connect Google Drive" description={problem} />
        )}
      </VStack>
    );
    actions = (
      <>
        <Button label="Cancel" variant="secondary" onClick={onClose} />
        <Button label="Connect Google Drive" variant="primary" clickAction={connect} />
      </>
    );
  } else {
    content = (
      <VStack gap={3}>
        <Text as="p">
          {sync.email ? `Syncing groups with ${sync.email}.` : 'Syncing groups with Google Drive.'}
        </Text>
        <SyncProgress />
        {problem && <Banner status="error" title="Couldn't sign in" description={problem} />}
        {sync.error && (
          <Banner
            status="error"
            title="Sync failed"
            description={sync.error.message}
            endContent={
              sync.error.needsConsent ? (
                <Button label="Allow" size="sm" clickAction={allowDataSending} />
              ) : sync.error.needsSignIn ? (
                <Button label="Sign in" size="sm" clickAction={reconnect} />
              ) : (
                <Button label="Retry" size="sm" clickAction={syncNow} />
              )
            }
          />
        )}
        <Text type="supporting" as="p">
          Turning sync off keeps your groups here, and in Drive for your other devices.
        </Text>
      </VStack>
    );
    actions = (
      <>
        <Button label="Turn off sync" variant="secondary" clickAction={disconnectDrive} />
        <Button label="Sync now" variant="secondary" clickAction={syncNow} />
        <Button label="Done" variant="primary" onClick={onClose} />
      </>
    );
  }

  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Layout
        header={<DialogHeader title="Sync with Google Drive" onOpenChange={onClose} />}
        content={<LayoutContent>{content}</LayoutContent>}
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              {actions}
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

/** When groups last synced, or that they're syncing */
function SyncProgress() {
  const { isSyncing, syncedAt } = useDriveSync();
  if (isSyncing) return <Text type="supporting">Syncing…</Text>;
  if (!syncedAt) return <Text type="supporting">Not synced yet</Text>;
  return (
    <HStack gap={1} vAlign="center">
      <Text type="supporting">Last synced</Text>
      <Timestamp value={Math.floor(syncedAt / 1000)} format="relative" isLive />
    </HStack>
  );
}

/** How sync is going, while it's on, as a button that opens the dialog */
export function DriveSyncButton({ onClick }: { onClick: () => void }) {
  const { isOn, isSyncing, error } = useDriveSync();
  if (!isOn) return null;
  const [icon, tooltip] = error
    ? [CloudAlert, `Sync failed: ${error.message}`]
    : isSyncing
      ? [CloudSync, 'Syncing with Google Drive']
      : [CloudCheck, 'Synced with Google Drive'];
  return (
    <IconButton
      label={tooltip}
      tooltip={tooltip}
      icon={<Icon icon={icon} />}
      variant="ghost"
      size="sm"
      onClick={onClick}
    />
  );
}
