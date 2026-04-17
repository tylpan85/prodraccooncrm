'use client';

import type { ServiceDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Skeleton } from '../../../../components/ui/skeleton';
import { ApiClientError } from '../../../../lib/api-client';
import { settingsApi } from '../../../../lib/settings-api';

function serviceErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'SERVICE_IN_USE') {
      return 'This service is already referenced by jobs. Deactivate it instead.';
    }
    if (error.code === 'SERVICE_DUPLICATE') {
      return 'Service names must be unique within the organization.';
    }
    return error.message;
  }
  return 'Could not save services right now.';
}

export default function SettingsServicesPage() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const servicesQuery = useQuery({
    queryKey: ['services', 'settings'],
    queryFn: () => settingsApi.listServices(true).then((result) => result.items),
  });

  const invalidateServices = () =>
    queryClient.invalidateQueries({
      queryKey: ['services'],
    });

  const createMutation = useMutation({
    mutationFn: (name: string) => settingsApi.createService({ name }),
    onSuccess: async () => {
      setNewName('');
      setFeedback(null);
      await invalidateServices();
    },
    onError: (error) => setFeedback(serviceErrorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: { id: string; payload: Partial<Pick<ServiceDto, 'name' | 'active'>> }) =>
      settingsApi.updateService(id, payload),
    onSuccess: async () => {
      setEditingId(null);
      setEditingName('');
      setFeedback(null);
      await invalidateServices();
    },
    onError: (error) => setFeedback(serviceErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteService(id),
    onSuccess: async () => {
      setFeedback(null);
      await invalidateServices();
    },
    onError: (error) => setFeedback(serviceErrorMessage(error)),
  });

  const services = useMemo(() => servicesQuery.data ?? [], [servicesQuery.data]);
  const busyId = (updateMutation.variables as { id?: string } | undefined)?.id;

  function startRename(service: ServiceDto) {
    setEditingId(service.id);
    setEditingName(service.name);
    setFeedback(null);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) {
      setFeedback('Service name is required.');
      return;
    }
    await createMutation.mutateAsync(name);
  }

  async function handleRename(serviceId: string) {
    const name = editingName.trim();
    if (!name) {
      setFeedback('Service name is required.');
      return;
    }
    await updateMutation.mutateAsync({ id: serviceId, payload: { name } });
  }

  async function handleDelete(service: ServiceDto) {
    setFeedback(null);
    if (!window.confirm(`Delete "${service.name}"?`)) return;
    await deleteMutation.mutateAsync(service.id);
  }

  return (
    <div className="px-6 py-8">
      <div className="max-w-5xl">
        <h1 className="text-xl font-semibold text-slate-900">Services</h1>
        <p className="mt-2 text-sm text-slate-500">
          Manage the service catalog shown when new jobs are created.
        </p>

        <form
          className="mt-6 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-end"
          onSubmit={handleCreate}
        >
          <div className="flex-1">
            <label htmlFor="new-service-name" className="block text-sm font-medium text-slate-700">
              Add service
            </label>
            <Input
              id="new-service-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Deep Cleaning"
              className="mt-1"
              disabled={createMutation.isPending}
            />
          </div>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Adding…' : 'Add'}
          </Button>
        </form>

        {feedback && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{feedback}</p>
        )}

        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Used by</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {servicesQuery.isLoading &&
                Array.from({ length: 3 }, (_, i) => (
                  <tr key={`skel-${i}`}>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-32" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-16" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-12" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-20" />
                    </td>
                  </tr>
                ))}

              {!servicesQuery.isLoading && services.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-sm text-slate-500">
                    No services yet.
                  </td>
                </tr>
              )}

              {services.map((service) => {
                const rowBusy =
                  deleteMutation.isPending && deleteMutation.variables === service.id
                    ? true
                    : updateMutation.isPending && busyId === service.id;

                return (
                  <tr key={service.id} className="align-top">
                    <td className="px-4 py-3">
                      {editingId === service.id ? (
                        <div className="flex gap-2">
                          <Input
                            value={editingName}
                            onChange={(event) => setEditingName(event.target.value)}
                            disabled={rowBusy}
                          />
                          <Button
                            size="sm"
                            disabled={rowBusy}
                            onClick={() => handleRename(service.id)}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={rowBusy}
                            onClick={() => {
                              setEditingId(null);
                              setEditingName('');
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="text-sm font-medium text-slate-900">{service.name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          service.active
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {service.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {service.usedByJobCount} jobs
                    </td>
                    <td className="px-4 py-3">
                      {editingId !== service.id && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={rowBusy}
                            onClick={() => startRename(service)}
                          >
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={rowBusy}
                            onClick={() =>
                              updateMutation.mutate({
                                id: service.id,
                                payload: { active: !service.active },
                              })
                            }
                          >
                            {service.active ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={rowBusy}
                            onClick={() => handleDelete(service)}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
