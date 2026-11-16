import { Bot, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState, ListSkeleton } from '@/components/PageStates';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorMessage } from '@/lib/api';
import type { Conversation } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  useDeleteConversationMutation,
  useListConversationsQuery,
  useRenameConversationMutation,
} from './api';

export function ConversationList({ onNavigate }: { onNavigate?: () => void }) {
  const { data, isLoading, error, refetch } = useListConversationsQuery();
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const [title, setTitle] = useState('');
  const [rename] = useRenameConversationMutation();
  const [remove] = useDeleteConversationMutation();

  // Both actions update the list right away. If the server refuses, the list goes back and this
  // explains why, so the dialogs do not need to stay open waiting.
  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    if (!renaming) return;
    setRenaming(null);
    try {
      await rename({ id: renaming.id, title }).unwrap();
    } catch (failure) {
      toast.error(`Could not rename this chat. ${apiErrorMessage(failure)}`);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleting(null);
    if (conversationId === deleting.id) void navigate('/app/chat');
    try {
      await remove(deleting.id).unwrap();
      toast.success('Chat deleted');
    } catch (failure) {
      toast.error(`Could not delete this chat. ${apiErrorMessage(failure)}`);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-3">
        <Button
          className="w-full"
          onClick={() => {
            void navigate('/app/chat');
            onNavigate?.();
          }}
        >
          <Plus className="size-4" aria-hidden />
          New chat
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {isLoading && <ListSkeleton rows={4} className="[&>*]:h-11" />}
        {error && <ErrorState error={error} onRetry={() => void refetch()} />}
        {data?.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            Your chats will appear here once you send a message.
          </p>
        )}
        <ul aria-label="Chats" className="space-y-0.5">
          {data?.map((conversation) => (
            <li key={conversation.id} className="group relative">
              <NavLink
                to={`/app/chat/${conversation.id}`}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-10 items-center gap-2 rounded-md py-2 pr-9 pl-2.5 text-sm transition-colors duration-150',
                    isActive ? 'bg-accent font-medium' : 'hover:bg-accent/60',
                  )
                }
              >
                {conversation.agentId && (
                  <Bot className="size-3.5 shrink-0 text-node-agent" aria-label="Agent chat" />
                )}
                <span className="truncate">{conversation.title}</span>
              </NavLink>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1 right-1 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                    aria-label={`Options for ${conversation.title}`}
                  >
                    <MoreHorizontal className="size-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setTitle(conversation.title);
                      setRenaming(conversation);
                    }}
                  >
                    <Pencil className="size-4" aria-hidden />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDeleting(conversation)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      </div>

      <Dialog open={Boolean(renaming)} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <form onSubmit={(event) => void submitRename(event)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Rename chat</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="chat-title">Name</Label>
              <Input
                id="chat-title"
                value={title}
                required
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit">Save name</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.title}” and all its messages will be gone for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep chat</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              Delete chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
