import { useState, useEffect } from 'react';
import { api } from '../api';
import { Webhook, WebhookDelivery } from '../types';

const WEBHOOK_EVENTS = [
  { value: 'card.created', label: 'Card Created' },
  { value: 'card.updated', label: 'Card Updated' },
  { value: 'card.moved', label: 'Card Moved' },
  { value: 'card.archived', label: 'Card Archived' },
  { value: 'card.deleted', label: 'Card Deleted' },
  { value: 'comment.created', label: 'Comment Created' },
  { value: 'board.created', label: 'Board Created' },
  { value: 'board.updated', label: 'Board Updated' },
];

interface WebhookSettingsProps {
  boardId?: string;
}

export default function WebhookSettings({ boardId }: WebhookSettingsProps) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formUrl, setFormUrl] = useState('');
  const [formEvents, setFormEvents] = useState<string[]>([]);
  const [formDescription, setFormDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [selectedWebhook, setSelectedWebhook] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);

  useEffect(() => {
    loadWebhooks();
  }, [boardId]);

  const loadWebhooks = async () => {
    try {
      setLoading(true);
      const data = boardId
        ? await api.getBoardWebhooks(boardId)
        : await api.getWebhooks();
      setWebhooks(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  };

  const loadDeliveries = async (webhookId: string) => {
    setLoadingDeliveries(true);
    try {
      const data = await api.getWebhookDeliveries(webhookId, 20);
      setDeliveries(data);
    } catch {
      setDeliveries([]);
    } finally {
      setLoadingDeliveries(false);
    }
  };

  const handleSelectWebhook = (id: string) => {
    if (selectedWebhook === id) {
      setSelectedWebhook(null);
      setDeliveries([]);
    } else {
      setSelectedWebhook(id);
      loadDeliveries(id);
    }
  };

  const handleCreate = async () => {
    if (!formUrl || formEvents.length === 0) return;

    setSaving(true);
    try {
      const result = await api.createWebhook({
        url: formUrl,
        events: formEvents,
        description: formDescription || undefined,
        board_id: boardId,
      });
      setWebhooks(prev => [result, ...prev]);
      setNewSecret(result.secret || null);
      resetForm();
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to create webhook');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingId || !formUrl || formEvents.length === 0) return;

    setSaving(true);
    try {
      const result = await api.updateWebhook(editingId, {
        url: formUrl,
        events: formEvents,
        description: formDescription || undefined,
      });
      setWebhooks(prev => prev.map(w => w.id === editingId ? result : w));
      resetForm();
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to update webhook');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this webhook?')) return;

    try {
      await api.deleteWebhook(id);
      setWebhooks(prev => prev.filter(w => w.id !== id));
      if (selectedWebhook === id) {
        setSelectedWebhook(null);
        setDeliveries([]);
      }
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to delete webhook');
    }
  };

  const handleToggleEnabled = async (webhook: Webhook) => {
    try {
      const result = await api.updateWebhook(webhook.id, {
        enabled: !webhook.enabled,
      });
      setWebhooks(prev => prev.map(w => w.id === webhook.id ? result : w));
    } catch (err: any) {
      setError(err.message || 'Failed to toggle webhook');
    }
  };

  const handleRegenerateSecret = async (id: string) => {
    if (!confirm('Regenerate secret? Your current secret will stop working.')) return;

    try {
      const result = await api.regenerateWebhookSecret(id);
      setNewSecret(result.secret);
    } catch (err: any) {
      setError(err.message || 'Failed to regenerate secret');
    }
  };

  const handleRedeliver = async (deliveryId: string) => {
    try {
      await api.redeliverWebhook(deliveryId);
      if (selectedWebhook) {
        loadDeliveries(selectedWebhook);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to redeliver');
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormUrl('');
    setFormEvents([]);
    setFormDescription('');
  };

  const startEdit = (webhook: Webhook) => {
    setEditingId(webhook.id);
    setFormUrl(webhook.url);
    setFormEvents(webhook.events);
    setFormDescription(webhook.description || '');
    setShowForm(true);
  };

  const toggleEvent = (event: string) => {
    setFormEvents(prev =>
      prev.includes(event)
        ? prev.filter(e => e !== event)
        : [...prev, event]
    );
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString();
  };

  if (loading) {
    return <div className="webhook-settings loading">Loading webhooks...</div>;
  }

  return (
    <div className="webhook-settings">
      {error && (
        <div className="webhook-error">{error}</div>
      )}

      {newSecret && (
        <div className="webhook-secret-modal">
          <div className="webhook-secret-content">
            <h3>Webhook Secret</h3>
            <p>Copy this secret now. You won't be able to see it again.</p>
            <code>{newSecret}</code>
            <button onClick={() => setNewSecret(null)}>Close</button>
          </div>
        </div>
      )}

      <div className="webhook-header">
        <h3>{boardId ? 'Board Webhooks' : 'Global Webhooks'}</h3>
        {!showForm && (
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            Add Webhook
          </button>
        )}
      </div>

      {showForm && (
        <div className="webhook-form">
          <div className="form-group">
            <label>URL</label>
            <input
              type="url"
              value={formUrl}
              onChange={e => setFormUrl(e.target.value)}
              placeholder="https://example.com/webhook"
            />
          </div>

          <div className="form-group">
            <label>Events</label>
            <div className="webhook-events-grid">
              {WEBHOOK_EVENTS.map(event => (
                <label key={event.value} className="webhook-event-checkbox">
                  <input
                    type="checkbox"
                    checked={formEvents.includes(event.value)}
                    onChange={() => toggleEvent(event.value)}
                  />
                  <span>{event.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Description (optional)</label>
            <input
              type="text"
              value={formDescription}
              onChange={e => setFormDescription(e.target.value)}
              placeholder="What is this webhook for?"
              maxLength={255}
            />
          </div>

          <div className="webhook-form-actions">
            <button onClick={resetForm} disabled={saving}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={editingId ? handleUpdate : handleCreate}
              disabled={saving || !formUrl || formEvents.length === 0}
            >
              {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      <div className="webhook-list">
        {webhooks.length === 0 ? (
          <div className="webhook-empty">
            No webhooks configured. Add one to get started.
          </div>
        ) : (
          webhooks.map(webhook => (
            <div
              key={webhook.id}
              className={`webhook-item ${selectedWebhook === webhook.id ? 'expanded' : ''}`}
            >
              <div
                className="webhook-item-header"
                onClick={() => handleSelectWebhook(webhook.id)}
              >
                <div className="webhook-item-main">
                  <span className={`webhook-status ${webhook.enabled ? 'active' : 'disabled'}`}>
                    {webhook.enabled ? 'Active' : 'Disabled'}
                  </span>
                  <span className="webhook-url">{webhook.url}</span>
                  {webhook.description && (
                    <span className="webhook-description">{webhook.description}</span>
                  )}
                </div>
                <div className="webhook-item-meta">
                  <span className="webhook-events-count">
                    {webhook.events.length} event{webhook.events.length !== 1 ? 's' : ''}
                  </span>
                  {webhook.last_delivery && (
                    <span
                      className={`webhook-last-status ${
                        webhook.last_delivery.status_code &&
                        webhook.last_delivery.status_code >= 200 &&
                        webhook.last_delivery.status_code < 300
                          ? 'success'
                          : 'error'
                      }`}
                    >
                      Last: {webhook.last_delivery.status_code || 'Error'}
                    </span>
                  )}
                </div>
              </div>

              {selectedWebhook === webhook.id && (
                <div className="webhook-item-details">
                  <div className="webhook-detail-section">
                    <h4>Events</h4>
                    <div className="webhook-events-tags">
                      {webhook.events.map(event => (
                        <span key={event} className="webhook-event-tag">
                          {event}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="webhook-detail-actions">
                    <button onClick={() => handleToggleEnabled(webhook)}>
                      {webhook.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => startEdit(webhook)}>Edit</button>
                    <button onClick={() => handleRegenerateSecret(webhook.id)}>
                      Regenerate Secret
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => handleDelete(webhook.id)}
                    >
                      Delete
                    </button>
                  </div>

                  <div className="webhook-detail-section">
                    <h4>Recent Deliveries</h4>
                    {loadingDeliveries ? (
                      <div className="webhook-deliveries-loading">Loading...</div>
                    ) : deliveries.length === 0 ? (
                      <div className="webhook-deliveries-empty">No deliveries yet</div>
                    ) : (
                      <div className="webhook-deliveries">
                        {deliveries.map(delivery => (
                          <div key={delivery.id} className="webhook-delivery">
                            <span className="delivery-event">{delivery.event_type}</span>
                            <span
                              className={`delivery-status ${
                                delivery.status_code &&
                                delivery.status_code >= 200 &&
                                delivery.status_code < 300
                                  ? 'success'
                                  : 'error'
                              }`}
                            >
                              {delivery.status_code || delivery.error || 'Pending'}
                            </span>
                            <span className="delivery-time">
                              {formatDate(delivery.created_at)}
                            </span>
                            {delivery.status_code &&
                              (delivery.status_code < 200 || delivery.status_code >= 300) && (
                              <button
                                className="btn-small"
                                onClick={() => handleRedeliver(delivery.id)}
                              >
                                Retry
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
