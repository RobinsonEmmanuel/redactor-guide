'use client';

import { use } from 'react';
import ServiceForm from '../_components/ServiceForm';

export default function EditServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ServiceForm serviceId={id} />;
}
