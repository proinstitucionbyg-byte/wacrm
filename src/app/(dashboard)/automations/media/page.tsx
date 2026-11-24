'use client';
import {FolderOpen} from 'lucide-react';
import {MediaLibrary} from '@/components/automations/media-library';
export default function MediaLibraryPage(){return <section className="crm-files-page"><header className="crm-files-page-header"><FolderOpen aria-hidden="true"/><div><h1>Mis archivos</h1><p>Tus carpetas, audios, imágenes, videos y documentos en un solo lugar.</p></div></header><MediaLibrary/></section>;}
