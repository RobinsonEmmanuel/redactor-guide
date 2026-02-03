'use client';

import { useParams } from 'next/navigation';
import TemplateForm from '@/components/TemplateForm';

export default function EditTemplatePage() {
  const params = useParams();
  const templateId = params.id as string;

  return <TemplateForm templateId={templateId} />;
}
