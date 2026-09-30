import type { ImageMetadata } from 'astro';

export type CaseMediaData = {
  alt: string;
  bordered?: boolean;
  desktopHug?: boolean;
  square?: boolean;
  objectPosition?: string;
} & ({ image: ImageMetadata; video?: never; webm?: never; poster?: never } | { image?: never; video: string; webm?: string; poster?: string });

export type CaseStage = CaseMediaData & {
  id: string;
  title: string;
  paragraphs: string[];
  meta?: { term: string; value: string }[];
  mobileAlign?: 'center' | 'top';
  tabletRadius?: 15;
  mobileRadius?: 15;
};

export interface CaseData {
  seoTitle: string;
  description: string;
  title: string;
  intro: string;
  tags: string[];
  hero: CaseMediaData;
  stages: CaseStage[];
}
