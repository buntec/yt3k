import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, ChevronDown, ChevronUp, Heart, Pin, ThumbsUp } from 'lucide-react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { Center } from '@astryxdesign/core/Center';
import { Icon } from '@astryxdesign/core/Icon';
import { Link } from '@astryxdesign/core/Link';
import { Spinner } from '@astryxdesign/core/Spinner';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import {
  type Comment,
  type CommentsPage,
  type CommentText,
  fetchComments,
  fetchMoreComments,
} from '@/utils/youtube';

/**
 * The comments on a video, loaded once they scroll into view, and more as
 * the end of them does. `onSeek` plays the video from a time a comment links to.
 */
export function VideoComments({
  videoId,
  onSeek,
}: {
  videoId: string;
  onSeek: (seconds: number) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [page, setPage] = useState<CommentsPage>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  // Set at once, unlike isLoading, so that the observers can't load a page twice
  const isLoadingRef = useRef(false);

  const load = async (continuation?: string) => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setIsLoading(true);
    setError(undefined);
    try {
      const next = continuation
        ? await fetchMoreComments(videoId, continuation)
        : await fetchComments(videoId);
      setPage((shown) =>
        shown ? { ...shown, comments: [...shown.comments, ...next.comments], continuation: next.continuation } : next,
      );
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  };

  // Only once they're about to be seen: the player hides them while minimized,
  // and many videos are watched without scrolling down to them.
  useEffect(() => {
    if (page || isLoading || error || !ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void load();
      },
      { rootMargin: '0px 0px 400px 0px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [page, isLoading, error]);

  return (
    <VStack ref={ref} as="section" className="player-comments" gap={4} aria-label="Comments">
      <Heading level={2}>{page?.count || 'Comments'}</Heading>
      {page && page.comments.length === 0 && !page.continuation && (
        <Text type="supporting">{page.message || 'No comments'}</Text>
      )}
      {page?.comments.map((comment) => (
        <CommentItem key={comment.id} comment={comment} videoId={videoId} onSeek={onSeek} />
      ))}
      {error ? (
        <LoadError error={error} onRetry={() => void load(page?.continuation)} />
      ) : (
        (!page || page.continuation) && (
          <MoreComments
            isLoading={isLoading}
            onLoad={() => void load(page?.continuation)}
            isAutomatic={page !== undefined}
          />
        )
      )}
    </VStack>
  );
}

/** A spinner that loads the next comments when it scrolls into view, or a button that does */
function MoreComments({
  isLoading,
  onLoad,
  isAutomatic,
}: {
  isLoading: boolean;
  onLoad: () => void;
  isAutomatic: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLoading || !isAutomatic || !ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onLoad();
      },
      { rootMargin: '0px 0px 600px 0px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [isLoading, isAutomatic, onLoad]);

  return (
    <div ref={ref}>
      <Center>
        {isAutomatic ? (
          <Button label="Show more comments" variant="ghost" isLoading={isLoading} onClick={onLoad} />
        ) : (
          <Spinner label="Loading comments" />
        )}
      </Center>
    </div>
  );
}

function LoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <HStack gap={3} vAlign="center">
      <span className="status error" role="status">
        <Text type="supporting" color="inherit">
          {error}
        </Text>
      </span>
      <Button label="Try again" variant="secondary" size="sm" onClick={onRetry} />
    </HStack>
  );
}

/**
 * A comment, with its replies. Those YouTube sent with it show right away;
 * the rest load when asked for.
 */
function CommentItem({
  comment,
  videoId,
  onSeek,
  isReply = false,
}: {
  comment: Comment;
  videoId: string;
  onSeek: (seconds: number) => void;
  isReply?: boolean;
}) {
  const { author } = comment;
  const [loaded, setLoaded] = useState<Comment[]>([]);
  const [moreReplies, setMoreReplies] = useState(comment.moreReplies);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const replies = [...comment.replies, ...loaded];

  const loadReplies = async () => {
    if (!moreReplies) return;
    setIsLoading(true);
    setError(undefined);
    try {
      const page = await fetchMoreComments(videoId, moreReplies);
      setLoaded((shown) => [...shown, ...page.comments]);
      setMoreReplies(page.continuation);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  // Top-level comments come without replies, which a toggle shows and hides.
  // Replies to replies come with them, and only need a button for more.
  const hasToggle = !isReply && comment.replyCount !== undefined;
  const showsReplies = !hasToggle || isOpen;

  return (
    <HStack as="article" gap={3} vAlign="start">
      <Avatar
        src={author.avatar}
        name={author.name}
        size={isReply ? 'sm' : 'md'}
        href={author.url}
        target="_blank"
        tooltip={false}
      />
      <StackItem size="fill">
        <VStack gap={1}>
          {comment.isPinned && (
            <HStack gap={1} vAlign="center">
              <Icon icon={Pin} size="xsm" color="secondary" />
              <Text type="supporting" size="sm">
                Pinned
              </Text>
            </HStack>
          )}
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Link
              href={author.url}
              target="_blank"
              color={author.isCreator ? 'accent' : 'primary'}
              weight="semibold"
              size="sm"
              tooltip={author.isCreator ? 'The channel that uploaded the video' : undefined}
            >
              {author.name}
            </Link>
            {author.isVerified && <Icon icon={BadgeCheck} size="xsm" color="secondary" label="Verified" />}
            <Text type="supporting" size="sm">
              {comment.published}
            </Text>
          </HStack>
          <span className="comment-text">
            <Text>
              <CommentBody text={comment.text} videoId={videoId} onSeek={onSeek} />
            </Text>
          </span>
          <HStack gap={3} vAlign="center" wrap="wrap">
            {comment.likes && (
              <HStack gap={1} vAlign="center">
                <Icon icon={ThumbsUp} size="xsm" color="secondary" label="Likes" />
                <Text type="supporting" size="sm" hasTabularNumbers>
                  {comment.likes}
                </Text>
              </HStack>
            )}
            {comment.isHearted && (
              <Icon icon={Heart} size="xsm" color="error" label="Hearted by the channel" />
            )}
            {hasToggle && (
              <Button
                label={
                  isOpen
                    ? 'Hide replies'
                    : `${comment.replyCount} ${comment.replyCount === '1' ? 'reply' : 'replies'}`
                }
                variant="ghost"
                size="sm"
                icon={<Icon icon={isOpen ? ChevronUp : ChevronDown} />}
                isLoading={isLoading && replies.length === 0}
                onClick={() => {
                  if (!isOpen && replies.length === 0) void loadReplies();
                  setIsOpen(!isOpen);
                }}
              />
            )}
          </HStack>
          {showsReplies && replies.length > 0 && (
            <VStack gap={4} paddingBlockStart={2}>
              {replies.map((reply) => (
                <CommentItem key={reply.id} comment={reply} videoId={videoId} onSeek={onSeek} isReply />
              ))}
            </VStack>
          )}
          {showsReplies && error && <LoadError error={error} onRetry={() => void loadReplies()} />}
          {showsReplies && !error && moreReplies && replies.length > 0 && (
            <HStack>
              <Button
                label="Show more replies"
                variant="ghost"
                size="sm"
                icon={<Icon icon={ChevronDown} />}
                isLoading={isLoading}
                onClick={() => void loadReplies()}
              />
            </HStack>
          )}
          {isReply && !error && moreReplies && replies.length === 0 && (
            <HStack>
              <Button
                label={comment.replyCount ? `${comment.replyCount} more replies` : 'Show replies'}
                variant="ghost"
                size="sm"
                icon={<Icon icon={ChevronDown} />}
                isLoading={isLoading}
                onClick={() => void loadReplies()}
              />
            </HStack>
          )}
        </VStack>
      </StackItem>
    </HStack>
  );
}

/**
 * A comment's text with its links: a time in the video plays it from there,
 * other links open in a new tab.
 */
function CommentBody({
  text,
  videoId,
  onSeek,
}: {
  text: CommentText[];
  videoId: string;
  onSeek: (seconds: number) => void;
}) {
  return text.map((part, i) => {
    if (part.seconds !== undefined) {
      const seconds = part.seconds;
      return (
        <Link
          key={i}
          href={`https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
              return;
            }
            event.preventDefault();
            onSeek(seconds);
          }}
        >
          {part.text}
        </Link>
      );
    }
    if (part.url) {
      return (
        <Link key={i} href={part.url} target="_blank">
          {part.text}
        </Link>
      );
    }
    return part.text;
  });
}
