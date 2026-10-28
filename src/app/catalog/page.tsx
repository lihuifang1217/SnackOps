import type { Metadata } from 'next';
import { CatalogBrowser } from '@/components/catalog/catalog-browser';

export const metadata: Metadata = {
  title: '业务数据目录',
  description: '以卡片查看业务数据，并维护商品、活动、优惠券、售后政策、FAQ 与转人工规则。',
};

export default function CatalogPage() {
  return <CatalogBrowser />;
}
