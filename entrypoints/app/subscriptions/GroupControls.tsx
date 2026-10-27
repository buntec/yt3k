import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuDivider,
  DropdownMenuItem,
} from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Selector } from '@astryxdesign/core/Selector';
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import { Token } from '@astryxdesign/core/Token';
import type { Channel } from '@/utils/youtube';
import {
  GROUP_COLORS,
  type Group,
  type GroupColor,
  type GroupFilter,
  createGroup,
  deleteGroup,
  editGroup,
  exportGroups,
  importGroups,
  nameProblem,
  restoreGroup,
  setGroupFilter,
  setGroups,
  setInGroup,
  unusedColor,
  useGroups,
} from './groups';

/** The page's sidebar: all channels, those in no group, and each group. */
export function GroupsNav({ channels, filter }: { channels: Channel[]; filter: GroupFilter }) {
  const { groups } = useGroups();
  const showToast = useToast();
  // The group being edited, or null for a new one
  const [editing, setEditing] = useState<Group | null>();

  const counts = useMemo(() => {
    const subscribed = new Set(channels.map((c) => c.id));
    const grouped = new Set(groups.flatMap((g) => g.channelIds));
    return {
      groups: new Map(
        groups.map((g) => [g.id, g.channelIds.filter((id) => subscribed.has(id)).length]),
      ),
      ungrouped: channels.filter((c) => !grouped.has(c.id)).length,
    };
  }, [channels, groups]);

  const remove = (group: Group) => {
    deleteGroup(group.id);
    if (filter === group.id) setGroupFilter('all');
    const hide = showToast({
      body: `Deleted ${group.name}`,
      uniqueID: `group-${group.id}`,
      // Long enough to reach for Undo
      autoHideDuration: 10_000,
      endContent: (
        <Button
          label="Undo"
          size="sm"
          variant="ghost"
          onClick={() => {
            hide();
            restoreGroup(group);
          }}
        />
      ),
    });
  };

  const download = () => {
    const url = URL.createObjectURL(
      new Blob([exportGroups(groups)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `yt3k-groups-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    // Firefox may not have started the download when click returns
    setTimeout(() => URL.revokeObjectURL(url));
  };

  const upload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const before = groups;
      try {
        importGroups(await file.text());
      } catch (err) {
        console.warn(err);
        showToast({ type: 'error', body: `${file.name} isn't a groups file` });
        return;
      }
      const hide = showToast({
        body: `Imported groups from ${file.name}`,
        uniqueID: 'group-import',
        autoHideDuration: 10_000,
        endContent: (
          <Button
            label="Undo"
            size="sm"
            variant="ghost"
            onClick={() => {
              hide();
              setGroups(before);
            }}
          />
        ),
      });
    };
    input.click();
  };

  return (
    <>
      <SideNav>
        <SideNavItem
          label="All channels"
          isSelected={filter === 'all'}
          onClick={() => setGroupFilter('all')}
          endContent={<Badge label={channels.length} />}
        />
        {groups.length > 0 && (
          <SideNavItem
            label="Not in a group"
            isSelected={filter === 'ungrouped'}
            onClick={() => setGroupFilter('ungrouped')}
            endContent={<Badge label={counts.ungrouped} />}
          />
        )}
        <SideNavSection
          title="Groups"
          endContent={
            <HStack gap={1} vAlign="center">
              <MoreMenu
                label="Group options"
                size="sm"
                alignment="end"
                items={[
                  {
                    label: 'Export groups',
                    icon: Download,
                    isDisabled: groups.length === 0,
                    onClick: download,
                  },
                  {
                    label: 'Import groups…',
                    icon: Upload,
                    description: 'Adds to the groups here',
                    onClick: upload,
                  },
                ]}
              />
              <IconButton
                label="New group"
                tooltip="New group"
                icon={<Icon icon={Plus} />}
                variant="ghost"
                size="sm"
                onClick={() => setEditing(null)}
              />
            </HStack>
          }
        >
          {groups.map((group) => (
            <SideNavItem
              key={group.id}
              label={group.name}
              isSelected={filter === group.id}
              onClick={() => setGroupFilter(group.id)}
              endContent={<Badge label={counts.groups.get(group.id) ?? 0} variant={group.color} />}
              actions={
                <MoreMenu
                  label={`${group.name} options`}
                  alignment="end"
                  items={[
                    { label: 'Edit', icon: Pencil, onClick: () => setEditing(group) },
                    {
                      label: 'Delete',
                      icon: Trash2,
                      variant: 'destructive',
                      onClick: () => remove(group),
                    },
                  ]}
                />
              }
            />
          ))}
          {groups.length === 0 && (
            <Text type="supporting">
              Sort channels into groups with the Add to group button next to each.
            </Text>
          )}
        </SideNavSection>
      </SideNav>
      {editing !== undefined && (
        <GroupDialog group={editing ?? undefined} onClose={() => setEditing(undefined)} />
      )}
    </>
  );
}

/** Creates a group, with `channelIds` in it, or edits `group`. */
function GroupDialog({
  group,
  channelIds,
  onClose,
}: {
  group?: Group;
  channelIds?: string[];
  onClose: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [color, setColor] = useState<GroupColor>(group?.color ?? unusedColor);
  const [problem, setProblem] = useState<string>();
  const nameRef = useRef<HTMLInputElement>(null);

  // The dialog focuses its title, which hasAutoFocus doesn't win over; this
  // runs after it, the dialog's effects running before its parent's.
  useEffect(() => nameRef.current?.focus(), []);

  const submit = () => {
    const problem = nameProblem(name, group?.id);
    if (problem) return setProblem(problem);
    if (group) editGroup(group.id, { name, color });
    else createGroup(name, color, channelIds);
    onClose();
  };

  const renderColor = (option: { value: string; label?: string }) => (
    <Token label={option.label!} color={option.value as GroupColor} size="sm" />
  );

  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} purpose="form">
      <Layout
        header={<DialogHeader title={group ? 'Edit group' : 'New group'} onOpenChange={onClose} />}
        content={
          <LayoutContent>
            <VStack gap={4}>
              <TextInput
                ref={nameRef}
                label="Name"
                value={name}
                onChange={(value) => {
                  setName(value);
                  setProblem(undefined);
                }}
                onEnter={submit}
                status={problem ? { type: 'error', message: problem } : undefined}
                autoComplete="off"
              />
              <Selector
                label="Color"
                options={GROUP_COLORS.map((c) => ({
                  value: c,
                  label: c[0]!.toUpperCase() + c.slice(1),
                }))}
                value={color}
                onChange={(value) => setColor(value as GroupColor)}
                renderOption={renderColor}
                renderValue={renderColor}
              />
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button label="Cancel" variant="secondary" onClick={onClose} />
              <Button label={group ? 'Save' : 'Create'} variant="primary" onClick={submit} />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

/** A menu of the groups to check the channel in or out of, and to create one. */
export function AddToGroupButton({ channel }: { channel: Channel }) {
  const { groups } = useGroups();
  const [isCreating, setIsCreating] = useState(false);
  return (
    <>
      <DropdownMenu
        button={{ label: 'Add to group', variant: 'ghost', size: 'sm' }}
        alignment="end"
        menuWidth={200}
      >
        {groups.map((group) => (
          <DropdownMenuCheckboxItem
            key={group.id}
            label={<Token label={group.name} color={group.color} size="sm" />}
            value={group.channelIds.includes(channel.id)}
            onChange={(isIn) => setInGroup(group.id, channel.id, isIn)}
          />
        ))}
        {groups.length > 0 && <DropdownMenuDivider />}
        <DropdownMenuItem label="New group…" icon={Plus} onClick={() => setIsCreating(true)} />
      </DropdownMenu>
      {isCreating && (
        <GroupDialog channelIds={[channel.id]} onClose={() => setIsCreating(false)} />
      )}
    </>
  );
}

/** The groups the channel is in; each shows its channels when clicked. */
export function GroupTokens({ channelId }: { channelId: string }) {
  const { groups } = useGroups();
  return groups
    .filter((g) => g.channelIds.includes(channelId))
    .map((group) => (
      <Token
        key={group.id}
        label={group.name}
        color={group.color}
        size="sm"
        description={`Show the channels in ${group.name}`}
        onClick={() => setGroupFilter(group.id)}
      />
    ));
}
