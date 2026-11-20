/**
 * Assistant Chat Panel component.
 * Displays the chat interface for the Assistant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  Alert,
  Button,
  Card,
  CloseIcon,
  DesignSystemEventProviderAnalyticsEventTypes,
  DesignSystemEventProviderComponentTypes,
  GearIcon,
  InfoTooltip,
  RefreshIcon,
  SparkleDoubleIcon,
  SparkleIcon,
  StopIcon,
  Tag,
  Tooltip,
  Typography,
  useDesignSystemTheme,
  SendIcon,
  WrenchSparkleIcon,
  Spinner,
} from '@databricks/design-system';
import { FormattedMessage, useIntl, type IntlShape } from '@databricks/i18n';

import { useAssistant } from './AssistantContext';
import { useAssistantPageContext } from './AssistantPageContext';
import { getAssistantProvider, getLlmProviderDisplay } from './providerRegistry';
import { AssistantErrorCode } from './types';
import { ApiKeyPrompt } from './ApiKeyPrompt';
import { GATEWAY_PROVIDER_ID } from './constants';
import { AssistantProviderPicker } from './AssistantProviderPicker';
import { AssistantContextTags } from './AssistantContextTags';
import { ToolPermissionPrompt } from './ToolPermissionPrompt';
import { ToolCallGroup, type ToolCallPart } from './ToolCallCard';
import type { AssistantPart, ChatMessage } from './types';
import { AssistantSettingsPage } from './setup';
import { useLogTelemetryEvent } from '../telemetry/hooks/useLogTelemetryEvent';
import { GenAIMarkdownRenderer } from '../shared/web-shared/genai-markdown-renderer';
import { useCopyController } from '../shared/web-shared/snippet/hooks/useCopyController';
import { useAssistantPrompts } from '../common/utils/RoutingUtils';
import { AssistantWelcomeCarousel } from './AssistantWelcomeCarousel';

type CurrentView = 'chat' | 'settings';

// Shared animation keyframes
const PULSE_ANIMATION = {
  '0%, 100%': { transform: 'scale(1)' },
  '50%': { transform: 'scale(1.3)' },
};

const DOTS_ANIMATION = {
  '0%': { content: '""' },
  '33%': { content: '"."' },
  '66%': { content: '".."' },
  '100%': { content: '"..."' },
};

// Abbreviate token counts for the compact usage footer (e.g. 45257 -> "45.3K").
// Formats through react-intl's locale so numbers match the surrounding FormattedMessage text.
const formatCompactTokens = (intl: IntlShape, n: number): string =>
  intl.formatNumber(n, { notation: 'compact', maximumFractionDigits: 1 });

// Sub-dollar estimates need more precision than cents (e.g. "$0.0045").
const formatCostUsd = (intl: IntlShape, cost: number): string =>
  intl.formatNumber(cost, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cost < 1 ? 4 : 2,
  });

export type MessagePartGroup = { kind: 'text'; text: string } | { kind: 'tools'; calls: ToolCallPart[] };

/**
 * Coalesces an ordered part list into render groups, collapsing each maximal run of
 * adjacent tool calls into a single `tools` group while preserving interleaving order.
 */
export const groupParts = (parts: AssistantPart[]): MessagePartGroup[] => {
  const groups: MessagePartGroup[] = [];
  for (const part of parts) {
    if (part.type === 'text') {
      groups.push({ kind: 'text', text: part.text });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last?.kind === 'tools') {
      groups[groups.length - 1] = { kind: 'tools', calls: [...last.calls, part] };
    } else {
      groups.push({ kind: 'tools', calls: [part] });
    }
  }
  return groups;
};

/**
 * Renders an assistant turn's ordered parts (text + tool calls). Falls back to plain
 * `content` for messages that predate the parts model.
 */
export const AssistantMessageBody = ({ message }: { message: ChatMessage }) => {
  const { theme } = useDesignSystemTheme();
  const parts: AssistantPart[] = message.parts ?? [{ type: 'text', text: message.content }];
  // The markdown renderer leaves `---` as a default <hr> and headings with tight margins,
  // so model-generated section breaks read cramped. Give rules and headings room to breathe.
  const markdownSpacing = {
    '& hr': {
      margin: `${theme.spacing.lg}px 0`,
      border: 'none',
      borderTop: `1px solid ${theme.colors.border}`,
    },
    '& h1, & h2, & h3, & h4': { marginTop: theme.spacing.md },
  };
  return (
    <>
      {groupParts(parts).map((group, i) =>
        group.kind === 'text' ? (
          group.text ? (
            <div key={`text-${i}`} css={markdownSpacing}>
              <GenAIMarkdownRenderer>{group.text}</GenAIMarkdownRenderer>
            </div>
          ) : null
        ) : (
          <ToolCallGroup key={group.calls[0].toolUseId} parts={group.calls} />
        ),
      )}
    </>
  );
};

/** Animated "working" indicator shown while the assistant streams a turn. */
const StreamingIndicator = () => {
  const { theme } = useDesignSystemTheme();
  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.sm,
        marginTop: theme.spacing.sm,
      }}
    >
      <SparkleIcon
        color="ai"
        css={{ fontSize: 16, animation: 'pulse 1.5s ease-in-out infinite', '@keyframes pulse': PULSE_ANIMATION }}
      />
      <span
        css={{
          fontSize: theme.typography.fontSizeBase,
          color: theme.colors.textSecondary,
          '&::after': {
            content: '"..."',
            animation: 'dots 1.5s steps(3, end) infinite',
            display: 'inline-block',
            width: '1.2em',
          },
          '@keyframes dots': DOTS_ANIMATION,
        }}
      >
        <FormattedMessage
          defaultMessage="Processing"
          description="Processing indicator while Assistant is streaming a response"
        />
      </span>
    </div>
  );
};

/**
 * Single chat message bubble.
 */
const ChatMessageBubble = ({
  message,
  isLastMessage,
  onRegenerate,
}: {
  message: ChatMessage;
  isLastMessage: boolean;
  onRegenerate?: () => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const isUser = message.role === 'user';
  const [isHovered, setIsHovered] = useState(false);
  const { actionIcon: copyIcon, tooltipMessage: copyTooltip, copy: handleCopy } = useCopyController(message.content);

  const handleRegenerate = () => {
    onRegenerate?.();
  };

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        marginBottom: isUser ? theme.spacing.md : 0,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        css={{
          maxWidth: isUser ? '85%' : '100%',
          padding: `${theme.spacing.md}px ${theme.spacing.md}px ${isUser ? theme.spacing.md : 0}px ${
            theme.spacing.md
          }px`,
          borderRadius: theme.borders.borderRadiusLg,
          backgroundColor: isUser ? theme.colors.backgroundSecondary : 'transparent',
          color: theme.colors.textPrimary,
        }}
      >
        {isUser ? (
          <Typography.Text css={{ whiteSpace: 'pre-wrap' }}>{message.content}</Typography.Text>
        ) : (
          <AssistantMessageBody message={message} />
        )}
        {/* Interrupted indicator */}
        {message.isInterrupted && (
          <span
            css={{
              display: 'block',
              marginTop: theme.spacing.sm,
              fontSize: theme.typography.fontSizeSm,
              fontStyle: 'italic',
              color: theme.colors.textSecondary,
            }}
          >
            Interrupted by user
          </span>
        )}
        {/* Loading indicator */}
        {message.isStreaming && <StreamingIndicator />}
      </div>

      {/* Action buttons for assistant messages */}
      {!isUser && !message.isStreaming && (
        <div
          css={{
            display: 'flex',
            gap: theme.spacing.xs,
            paddingLeft: theme.spacing.md,
            opacity: isLastMessage || isHovered ? 1 : 0,
            pointerEvents: isLastMessage || isHovered ? 'auto' : 'none',
            transition: 'opacity 0.2s ease',
          }}
        >
          <Tooltip componentId="mlflow.assistant.chat_panel.copy.tooltip" content={copyTooltip}>
            <Button componentId="mlflow.assistant.chat_panel.copy" size="small" icon={copyIcon} onClick={handleCopy} />
          </Tooltip>
          {isLastMessage && (
            <Tooltip componentId="mlflow.assistant.chat_panel.regenerate.tooltip" content="Regenerate">
              <Button
                componentId="mlflow.assistant.chat_panel.regenerate"
                size="small"
                icon={<RefreshIcon />}
                onClick={handleRegenerate}
              />
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Initial prompt suggestions empty state.
 */
/**
 * 简体中文提示词映射：路由中定义的英文提示词在展示时转成中文。
 * 未收录的提示词保持原文。
 */
const ASSISTANT_PROMPT_ZH: Record<string, string> = {
  'How do I get started with MLflow?': '如何开始使用 MLflow？',
  'What should I know about MLflow?': '关于 MLflow，我需要了解什么？',
  'Explain how MLflow Tracing works.': '解释 MLflow 追踪是如何工作的。',
  'How do I create a new prompt?': '如何创建新的提示词？',
  'How do I version my prompts?': '如何对提示词进行版本管理？',
  'How do I use prompts with my LLM application?': '如何在大语言模型应用中使用提示词？',
  'Explain what this prompt does.': '解释这个提示词的作用。',
  'How can I improve this prompt?': '如何改进这个提示词？',
  'Show me how to use this prompt in code.': '演示如何在代码中使用这个提示词。',
  'How do I create a new experiment?': '如何创建新实验？',
  'How do I organize my experiments?': '如何组织我的实验？',
  'Show me my recent experiments.': '展示我最近的实验。',
  'How do I get started with MLflow for my agent?': '如何为我的智能体开始使用 MLflow？',
  'Find common failure modes in recent traces.': '找出近期追踪链路中的常见失败模式。',
  'How do I set up evaluation?': '如何设置评估？',
  'What is the trend of token usage?': 'token 用量的趋势如何？',
  'Why did the error rate spike?': '错误率为何飙升？',
  'Which tools are slowest?': '哪些工具最慢？',
  'Compare the selected runs.': '比较选中的运行。',
  'Which run performed best?': '哪次运行表现最好？',
  'What parameters differ between runs?': '各次运行之间的参数有何差异？',
  'Debug the error in this trace.': '调试此追踪链路中的错误。',
  'What is the performance bottleneck in this trace?': '此追踪链路的性能瓶颈是什么？',
  'How to measure the quality of my agent with traces?': '如何用追踪链路衡量智能体的质量？',
  'How to group multiple traces by session?': '如何按会话对多条追踪链路分组？',
  'What topics were discussed in this session?': '本次会话讨论了哪些主题？',
  'Were there any issues in this conversation?': '这段对话中是否存在问题？',
  'Summarize this chat session.': '总结这个聊天会话。',
  'What was the outcome of this conversation?': '这段对话的结果是什么？',
  'Identify any issues in this chat.': '找出此聊天中的问题。',
  'Which model should I use for production?': '生产环境应该使用哪个模型？',
  'Compare these models.': '比较这些模型。',
  'What are the differences between model versions?': '各模型版本之间有何差异？',
  'Summarize the evaluation results.': '总结评估结果。',
  'Which model performed best in evaluation?': '评估中哪个模型表现最好？',
  'What metrics should I focus on?': '我应该关注哪些指标？',
  'How do I create LLM judge for testing the quality of my agent?': '如何创建 LLM 评判器来测试智能体质量？',
  'Which built-in LLM judges should I use for my project?': '我的项目应该使用哪些内置 LLM 评判器？',
  'How to run my judges on traces?': '如何对追踪链路运行评判器？',
  'How to add a new record to a dataset?': '如何向数据集添加新记录？',
  'How do I use this dataset for evaluation?': '如何使用此数据集进行评估？',
  'What format should my dataset be in?': '数据集应该采用什么格式？',
  'How to add a new record to this dataset?': '如何向此数据集添加新记录？',
  'How do I use registered prompts with my LLM application?': '如何在 LLM 应用中使用已注册的提示词？',
  'Which prompt performs best for my project?': '哪个提示词对我的项目效果最好？',
  'Explain this model.': '解释这个模型。',
  'How do I deploy this model?': '如何部署这个模型？',
  'What are the model inputs and outputs?': '模型的输入和输出是什么？',
  'Compare these experiments.': '比较这些实验。',
  'Which experiment performed best?': '哪个实验表现最好？',
  'What are the key differences?': '主要差异是什么？',
};

const PromptSuggestions = ({ onSelect }: { onSelect: (prompt: string) => void }) => {
  const { theme } = useDesignSystemTheme();
  const suggestions = useAssistantPrompts();

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.spacing.lg * 2,
        gap: theme.spacing.lg,
      }}
    >
      <WrenchSparkleIcon color="ai" css={{ fontSize: 64, opacity: 0.75 }} />

      <Typography.Text
        color="secondary"
        css={{
          fontSize: theme.typography.fontSizeMd,
          textAlign: 'center',
          maxWidth: 400,
        }}
      >
        <FormattedMessage
          defaultMessage="Ask questions about your experiments, traces, evaluations, and more."
          description="Empty state description in the Assistant chat panel"
        />
      </Typography.Text>

      {/* Suggestion cards */}
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: theme.spacing.sm,
          width: '100%',
          maxWidth: 400,
        }}
      >
        {suggestions.map((suggestion) => {
          const label = ASSISTANT_PROMPT_ZH[suggestion] ?? suggestion;
          return (
            <Card
              componentId="mlflow.assistant.chat_panel.suggestion.card"
              key={suggestion}
              onClick={() => onSelect(label)}
              css={{
                cursor: 'pointer',
                padding: theme.spacing.sm,
                transition: 'all 0.2s ease',
                '&:hover': {
                  borderColor: theme.colors.actionPrimaryBackgroundDefault,
                },
              }}
            >
              <div
                css={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                }}
              >
                <SparkleIcon color="ai" css={{ fontSize: 18, flexShrink: 0 }} />
                <span>{label}</span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Chat panel content component.
 */
/**
 * A stream error the user can act on directly (install/login/configure), rendered as a
 * callout above the composer with a shortcut to the settings flow.
 */
const RecoverableErrorCallout = ({
  errorCode,
  error,
  onOpenSettings,
}: {
  errorCode: string;
  error: string | null;
  onOpenSettings: () => void;
}) => {
  const { theme } = useDesignSystemTheme();

  let message: React.ReactNode;
  switch (errorCode) {
    case AssistantErrorCode.CliNotInstalled:
      message = (
        <FormattedMessage
          defaultMessage="The provider's CLI is not installed on the MLflow server. Install it, or switch to another provider."
          description="Callout shown when the assistant provider CLI is missing"
        />
      );
      break;
    case AssistantErrorCode.NotAuthenticated:
      message = (
        <FormattedMessage
          defaultMessage="The provider is not authenticated. Fix the credentials, or switch to another provider."
          description="Callout shown when the assistant provider rejected the credentials"
        />
      );
      break;
    default:
      message = (
        <FormattedMessage
          defaultMessage="No assistant provider is available. Configure one in Settings."
          description="Callout shown when no assistant provider could serve the chat"
        />
      );
  }

  return (
    <Alert
      componentId="mlflow.assistant.chat_panel.recoverable_error"
      type="warning"
      closable={false}
      css={{ marginBottom: theme.spacing.sm }}
      message={message}
      description={
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs, alignItems: 'flex-start' }}>
          {error && (
            <Typography.Text size="sm" color="secondary" css={{ wordBreak: 'break-word' }}>
              {error}
            </Typography.Text>
          )}
          <Button
            componentId="mlflow.assistant.chat_panel.recoverable_error.action"
            size="small"
            onClick={onOpenSettings}
          >
            <FormattedMessage
              defaultMessage="Open Settings"
              description="Button on the assistant error callout that opens the settings flow"
            />
          </Button>
        </div>
      }
    />
  );
};

// api_key_missing is deliberately absent: it renders the inline ApiKeyPrompt instead.
const RECOVERABLE_ERROR_CODES = new Set<string>([
  AssistantErrorCode.CliNotInstalled,
  AssistantErrorCode.NotAuthenticated,
  AssistantErrorCode.NoProvider,
]);

const ChatPanelContent = ({ onOpenSettings }: { onOpenSettings: () => void }) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const {
    messages,
    isStreaming,
    error,
    errorCode,
    sendMessage,
    regenerateLastMessage,
    cancelSession,
    tokenUsage,
    activeProvider,
    providers,
    gatewayVendorOptions,
    selectProvider,
    canUseAssistant,
    needsApiKey,
    refreshConfig,
    pendingPrompt,
    clearPendingPrompt,
    pendingComposerFocus,
    clearComposerFocusRequest,
    pendingAutomaticMessage,
    forceSendPendingAutomaticMessage,
    pendingPermission,
    respondToPermission,
  } = useAssistant();
  const logTelemetryEvent = useLogTelemetryEvent();
  const viewId = useMemo(() => uuidv4(), []);

  const [inputValue, setInputValue] = useState('');
  // A message stashed while the API-key modal collects the missing key; sent on save.
  const [pendingKeyMessage, setPendingKeyMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea to fit content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [inputValue]);

  // Consume a prompt queued by an onboarding card once the chat input is visible.
  useEffect(() => {
    if (pendingPrompt != null) {
      setInputValue(pendingPrompt);
      clearPendingPrompt();
      textareaRef.current?.focus();
    }
  }, [pendingPrompt, clearPendingPrompt]);

  useEffect(() => {
    if (pendingComposerFocus) {
      textareaRef.current?.focus();
      clearComposerFocusRequest();
    }
  }, [pendingComposerFocus, clearComposerFocusRequest]);

  // Deliver a message, first collecting the resolved provider's API key when it
  // is still missing (the ideal-flow popup: the first send doubles as setup).
  const deliverMessage = useCallback(
    (message: string) => {
      if (needsApiKey && activeProvider) {
        setPendingKeyMessage(message);
        return;
      }
      sendMessage(message);
    },
    [activeProvider, needsApiKey, sendMessage],
  );

  const handleApiKeySaved = useCallback(() => {
    const message = pendingKeyMessage;
    setPendingKeyMessage(null);
    // Send right away: this clears any api_key_missing error in the same render,
    // so the prompt hides immediately instead of lingering while a refresh runs.
    // (The key is already saved server-side; the send carries it.) If the prompt
    // came from a failed send rather than a queued message, retry that turn.
    if (pendingAutomaticMessage) {
      forceSendPendingAutomaticMessage();
    } else if (message) {
      sendMessage(message);
    } else {
      regenerateLastMessage();
    }
    // Update the resolved-provider / needsApiKey state in the background.
    refreshConfig();
  }, [
    pendingKeyMessage,
    pendingAutomaticMessage,
    forceSendPendingAutomaticMessage,
    sendMessage,
    regenerateLastMessage,
    refreshConfig,
  ]);

  // If the key prompt is dismissed sideways (e.g. the user switches provider from
  // the picker instead of entering a key), put the stashed message back in the
  // input so nothing typed is lost.
  useEffect(() => {
    if (pendingKeyMessage != null && !needsApiKey) {
      setInputValue((current) => current || pendingKeyMessage);
      setPendingKeyMessage(null);
    }
  }, [needsApiKey, pendingKeyMessage]);

  const handleSend = useCallback(() => {
    if (inputValue.trim() && !isStreaming) {
      deliverMessage(inputValue.trim());
      setInputValue('');
    }
  }, [inputValue, isStreaming, deliverMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (inputValue.trim() && !isStreaming) {
          logTelemetryEvent({
            componentId: 'mlflow.assistant.chat_panel.send',
            componentViewId: viewId,
            componentType: DesignSystemEventProviderComponentTypes.Button,
            componentSubType: null,
            eventType: DesignSystemEventProviderAnalyticsEventTypes.OnClick,
          });
        }
        handleSend();
      }
    },
    [handleSend, inputValue, isStreaming, logTelemetryEvent, viewId],
  );

  const handleSuggestionSelect = useCallback(
    (prompt: string) => {
      deliverMessage(prompt);
    },
    [deliverMessage],
  );

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Messages area */}
      <div
        css={{
          flex: 1,
          overflowY: 'auto',
          padding: theme.spacing.lg,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: messages.length === 0 && !isStreaming ? 'center' : 'flex-start',
          alignItems: messages.length === 0 && !isStreaming ? 'center' : 'stretch',
        }}
        onWheel={(e) => e.stopPropagation()}
      >
        {messages.length === 0 && !isStreaming && <PromptSuggestions onSelect={handleSuggestionSelect} />}

        {messages.map((message, index) => {
          // Check if this is the last assistant message
          const isLastAssistantMessage = message.role === 'assistant' && index === messages.length - 1;
          return (
            <ChatMessageBubble
              key={message.id}
              message={message}
              isLastMessage={isLastAssistantMessage}
              onRegenerate={isLastAssistantMessage ? regenerateLastMessage : undefined}
            />
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div
        css={{
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px ${theme.spacing.md}px ${theme.spacing.md}px`,
          flexShrink: 0,
        }}
      >
        {pendingPermission && <ToolPermissionPrompt request={pendingPermission} onRespond={respondToPermission} />}
        {errorCode && RECOVERABLE_ERROR_CODES.has(errorCode) && (
          <RecoverableErrorCallout errorCode={errorCode} error={error} onOpenSettings={onOpenSettings} />
        )}
        {(pendingKeyMessage != null ||
          (pendingAutomaticMessage != null && needsApiKey) ||
          errorCode === AssistantErrorCode.ApiKeyMissing) &&
          activeProvider && (
            <ApiKeyPrompt
              providerId={activeProvider.name}
              providerName={
                (activeProvider.name === GATEWAY_PROVIDER_ID && activeProvider.model_provider
                  ? getLlmProviderDisplay(activeProvider.model_provider)?.name
                  : undefined) ??
                getAssistantProvider(activeProvider.name)?.name ??
                activeProvider.name
              }
              gatewayVendor={
                activeProvider.name === GATEWAY_PROVIDER_ID ? (activeProvider.model_provider ?? undefined) : undefined
              }
              providerModel={activeProvider.provider_model}
              onSaved={handleApiKeySaved}
            />
          )}
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.borders.borderRadiusMd,
            padding: `${theme.spacing.sm}px ${theme.spacing.sm}px`,
            backgroundColor: theme.colors.backgroundPrimary,
          }}
        >
          <AssistantContextTags />
          <textarea
            ref={textareaRef}
            placeholder={intl.formatMessage({
              defaultMessage: 'Ask a question...',
              description: 'Placeholder text for the Assistant chat input',
            })}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            css={{
              width: '100%',
              border: 'none',
              outline: 'none',
              backgroundColor: 'transparent',
              fontSize: theme.typography.fontSizeBase,
              color: theme.colors.textPrimary,
              padding: theme.spacing.xs,
              resize: 'none',
              overflowX: 'hidden',
              overflowY: 'auto',
              fontFamily: 'inherit',
              lineHeight: 'inherit',
              maxHeight: 150,
              '&::placeholder': {
                color: theme.colors.textPlaceholder,
              },
              '&:focus': {
                border: 'none',
                outline: 'none',
              },
            }}
          />
          <div
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
              paddingTop: theme.spacing.sm,
              marginTop: theme.spacing.xs,
              borderTop: `1px solid ${theme.colors.borderDecorative}`,
            }}
          >
            {activeProvider && (
              <AssistantProviderPicker
                provider={activeProvider}
                providers={providers}
                gatewayVendorOptions={gatewayVendorOptions}
                disabled={!canUseAssistant}
                onSelect={selectProvider}
              />
            )}
            <div css={{ flex: 1 }} />
            {tokenUsage.totalTokens > 0 && (
              <div css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.xs }}>
                <Typography.Text size="sm" color="secondary" css={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatCompactTokens(intl, tokenUsage.totalTokens)}
                </Typography.Text>
                <InfoTooltip
                  componentId="mlflow.assistant.chat_panel.usage_info"
                  content={
                    <div
                      css={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: theme.spacing.xs,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      <span>
                        <FormattedMessage
                          defaultMessage="Input {input} · Output {output} tokens"
                          description="Breakdown of session token usage into input (prompt) and output (completion) tokens"
                          values={{
                            input: intl.formatNumber(tokenUsage.promptTokens - tokenUsage.cacheReadTokens),
                            output: intl.formatNumber(tokenUsage.completionTokens),
                          }}
                        />
                      </span>
                      {tokenUsage.cacheReadTokens > 0 && (
                        <span>
                          <FormattedMessage
                            defaultMessage="Cached {cached} tokens, reused conversation context billed at a reduced rate"
                            description="Portion of input tokens re-read from the provider's prompt cache across turns"
                            values={{ cached: intl.formatNumber(tokenUsage.cacheReadTokens) }}
                          />
                        </span>
                      )}
                      {tokenUsage.costUsd != null ? (
                        <span>
                          <FormattedMessage
                            defaultMessage="Estimated cost ~{cost}, from public model pricing; actual may vary (provider and cache rates)."
                            description="Estimated session cost with a disclaimer that it is approximate"
                            values={{ cost: formatCostUsd(intl, tokenUsage.costUsd) }}
                          />
                        </span>
                      ) : (
                        <span>
                          <FormattedMessage
                            defaultMessage="Cost estimate unavailable for this model."
                            description="Shown when the assistant's model is not in the pricing catalog so cost cannot be estimated"
                          />
                        </span>
                      )}
                    </div>
                  }
                />
              </div>
            )}
            <Button
              componentId="mlflow.assistant.chat_panel.send"
              onClick={isStreaming ? cancelSession : handleSend}
              disabled={!isStreaming && !inputValue.trim()}
              icon={isStreaming ? <StopIcon /> : <SendIcon />}
              aria-label={intl.formatMessage({
                defaultMessage: 'Send message',
                description: 'Aria label for the Assistant send message button',
              })}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Loading state while fetching setup status.
 */
const SetupLoadingState = () => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: theme.spacing.md,
      }}
    >
      <Spinner size="default" />
      <Typography.Text color="secondary">Loading...</Typography.Text>
    </div>
  );
};

/**
 * Message shown when this client is not allowed to use the Assistant,
 * e.g. a remote client when the server's remote-access settings don't permit it.
 */
const RemoteServerMessage = ({ onClose }: { onClose: () => void }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        minHeight: 0,
        padding: theme.spacing.lg,
        paddingBottom: theme.spacing.lg * 3,
        gap: theme.spacing.lg,
      }}
    >
      <WrenchSparkleIcon color="ai" css={{ fontSize: 64, opacity: 0.5 }} />

      <Typography.Title level={4} css={{ textAlign: 'center', marginBottom: 0 }}>
        <FormattedMessage
          defaultMessage="Assistant Not Available"
          description="Title shown when Assistant is not available for this client"
        />
      </Typography.Title>

      <Typography.Text
        color="secondary"
        css={{
          fontSize: theme.typography.fontSizeMd,
          textAlign: 'center',
          maxWidth: 400,
        }}
      >
        <FormattedMessage
          defaultMessage="MLflow Assistant is not available from this client. Ask your MLflow server administrator to enable remote access if you need to use it remotely."
          description="Message explaining that the Assistant is blocked by the server's remote-access settings"
        />
      </Typography.Text>

      <Button componentId="mlflow.assistant.chat_panel.remote_close" onClick={onClose}>
        <FormattedMessage defaultMessage="Close" description="Button to close the assistant panel on remote servers" />
      </Button>
    </div>
  );
};

const RemoteSetupRequiredMessage = ({ onClose }: { onClose: () => void }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        minHeight: 0,
        padding: theme.spacing.lg,
        paddingBottom: theme.spacing.lg * 3,
        gap: theme.spacing.lg,
      }}
    >
      <WrenchSparkleIcon color="ai" css={{ fontSize: 64, opacity: 0.5 }} />

      <Typography.Title level={4} css={{ textAlign: 'center', marginBottom: 0 }}>
        <FormattedMessage
          defaultMessage="Assistant setup required"
          description="Title shown when a remote client cannot configure Assistant setup"
        />
      </Typography.Title>

      <Typography.Text
        color="secondary"
        css={{
          fontSize: theme.typography.fontSizeMd,
          textAlign: 'center',
          maxWidth: 400,
        }}
      >
        <FormattedMessage
          defaultMessage="MLflow Assistant needs to be configured on the MLflow server host before remote clients can use it. Ask your server administrator to open MLflow locally and complete Assistant setup."
          description="Message explaining that Assistant setup must be completed locally by a server admin"
        />
      </Typography.Text>

      <Button componentId="mlflow.assistant.chat_panel.remote_setup_close" onClick={onClose}>
        <FormattedMessage defaultMessage="Close" description="Button to close the assistant panel on remote servers" />
      </Button>
    </div>
  );
};

/**
 * Empty state shown when no assistant provider can be resolved.
 */
const SetupPrompt = () => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        padding: theme.spacing.sm,
        gap: theme.spacing.md,
      }}
    >
      <AssistantWelcomeCarousel />
    </div>
  );
};

/**
 * Assistant Chat Panel.
 * Shows the chat header and the chat interface.
 * When setup is incomplete, shows a banner prompting the user to set up.
 */
export const AssistantChatPanel = () => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const { closePanel, reset, setupComplete, isLoadingConfig, canUseAssistant, isLocalServer, refreshConfig } =
    useAssistant();
  const context = useAssistantPageContext();
  const experimentId = context['experimentId'] as string | undefined;

  const [currentView, setCurrentView] = useState<CurrentView>('chat');

  const handleClose = useCallback(() => {
    closePanel();
  }, [closePanel]);

  const handleReset = useCallback(() => {
    reset();
  }, [reset]);

  const handleOpenSettings = useCallback(() => {
    setCurrentView('settings');
  }, []);

  const handleBackFromSettings = useCallback(() => {
    // Re-read the config so the composer's provider indicator reflects any
    // change made in settings; without this it stays stale until a reload.
    // `silent` avoids flashing the full-panel loading state over the chat,
    // since the panel is already open during back-navigation.
    refreshConfig({ silent: true });
    setCurrentView('chat');
  }, [refreshConfig]);

  const renderContent = () => {
    // Show message when this client isn't allowed to use the Assistant
    // (e.g. a remote client and the server's remote-access settings don't permit it)
    if (!canUseAssistant) {
      return <RemoteServerMessage onClose={handleClose} />;
    }

    // Show loading state while fetching config
    if (isLoadingConfig) {
      return <SetupLoadingState />;
    }

    if (!isLocalServer && !setupComplete) {
      return <RemoteSetupRequiredMessage onClose={handleClose} />;
    }

    switch (currentView) {
      case 'settings':
        return <AssistantSettingsPage experimentId={experimentId} onBack={handleBackFromSettings} />;
      case 'chat':
      default:
        // With server-side default resolution this only happens when nothing is
        // usable at all (e.g. a fresh remote-accessible server with no gateway endpoint).
        if (!setupComplete) {
          return <SetupPrompt />;
        }
        return <ChatPanelContent onOpenSettings={handleOpenSettings} />;
    }
  };

  // Determine if we should show the chat controls (new chat button)
  const showChatControls = setupComplete && currentView === 'chat';

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: theme.spacing.md,
          borderBottom: `1px solid ${theme.colors.border}`,
          flexShrink: 0,
        }}
      >
        <span
          css={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
            fontWeight: theme.typography.typographyBoldFontWeight,
            fontSize: theme.typography.fontSizeMd + 2,
          }}
        >
          <SparkleDoubleIcon color="ai" css={{ fontSize: 20 }} />
          <FormattedMessage defaultMessage="MLflow Assistant" description="Title for the global Assistant chat panel" />
          <Tag componentId="mlflow.assistant.chat_panel.beta" color="turquoise">
            <FormattedMessage defaultMessage="Beta" description="Beta badge shown next to the Assistant title" />
          </Tag>
        </span>
        <div css={{ display: 'flex', gap: theme.spacing.xs }}>
          {showChatControls && (
            <>
              <Tooltip
                componentId="mlflow.assistant.chat_panel.reset.tooltip"
                content={intl.formatMessage({
                  defaultMessage: 'New Chat',
                  description: 'Tooltip for starting a new Assistant chat',
                })}
              >
                <Button
                  componentId="mlflow.assistant.chat_panel.reset"
                  size="small"
                  icon={<RefreshIcon />}
                  onClick={handleReset}
                  aria-label={intl.formatMessage({
                    defaultMessage: 'New Chat',
                    description: 'Aria label for starting a new Assistant chat',
                  })}
                />
              </Tooltip>
              <Tooltip
                componentId="mlflow.assistant.chat_panel.settings.tooltip"
                content={
                  canUseAssistant
                    ? intl.formatMessage({
                        defaultMessage: 'Settings',
                        description: 'Tooltip for the Assistant settings button',
                      })
                    : intl.formatMessage({
                        defaultMessage:
                          'Updating Assistant settings is not allowed for a remote MLflow server. ' +
                          'Contact your server admin to update the settings.',
                        description:
                          'Tooltip explaining that Assistant settings cannot be changed from a remote client',
                      })
                }
              >
                <Button
                  componentId="mlflow.assistant.chat_panel.settings"
                  size="small"
                  icon={<GearIcon />}
                  onClick={handleOpenSettings}
                  aria-label={intl.formatMessage({
                    defaultMessage: 'Settings',
                    description: 'Aria label for the Assistant settings button',
                  })}
                  disabled={!canUseAssistant}
                />
              </Tooltip>
            </>
          )}
          <Tooltip
            componentId="mlflow.assistant.chat_panel.close.tooltip"
            content={intl.formatMessage({
              defaultMessage: 'Close',
              description: 'Tooltip for closing the Assistant chat panel',
            })}
          >
            <Button
              componentId="mlflow.assistant.chat_panel.close"
              size="small"
              icon={<CloseIcon />}
              onClick={handleClose}
              aria-label={intl.formatMessage({
                defaultMessage: 'Close',
                description: 'Aria label for closing the Assistant chat panel',
              })}
            />
          </Tooltip>
        </div>
      </div>
      {renderContent()}
    </div>
  );
};
