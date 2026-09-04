import { Box, Flex, Icon, Link, Spinner, Stack, Text } from '@kvib/react';
import { useTranslation } from 'react-i18next';
import { KnownKulturminne, KulturminnerResult } from '../api/kulturminnerWfs';

// Register codes → readable labels. Domain vocabulary from Askeladden,
// left in Norwegian on purpose; unknown codes fall back to the raw code.
const KATEGORI_LABELS: Record<string, string> = {
  'L-ARK': 'Arkeologisk minne',
  'L-BVF': 'Bebyggelse/infrastruktur',
  'L-KRK': 'Kirkested',
};

const VERNETYPE_LABELS: Record<string, string> = {
  AUT: 'Automatisk fredet',
  VED: 'Vedtaksfredet',
  FOR: 'Forskriftsfredet',
  MID: 'Midlertidig fredet',
  LIST: 'Listeført',
  KOM: 'Kommunalt vern',
  UAV: 'Uavklart',
  IKKE: 'Ikke fredet',
  FJE: 'Fjernet',
};

const KulturminneRow = ({ km }: { km: KnownKulturminne }) => {
  const { t } = useTranslation();
  const name = km.navn || t('localities.kulturminner.unnamed');
  const kategori = KATEGORI_LABELS[km.kategori] ?? km.kategori;
  const vern = VERNETYPE_LABELS[km.vernetype] ?? km.vernetype;
  const body = (
    <Flex justify="space-between" align="center" gap={2} py={1.5} px={1}>
      <Box flex="1" minW={0}>
        <Text fontSize="xs" fontWeight="medium" lineClamp={1}>
          {name}
          {km.antallEnkeltminner != null && km.antallEnkeltminner > 1
            ? ` (${km.antallEnkeltminner})`
            : ''}
        </Text>
        <Text fontSize="10px" color="gray.600" lineClamp={1}>
          {[kategori, vern].filter(Boolean).join(' · ')}
        </Text>
      </Box>
      {km.linkKulturminnesok && (
        <Box color="green.700" flexShrink={0} display="flex">
          <Icon icon="open_in_new" size={14} />
        </Box>
      )}
    </Flex>
  );
  return km.linkKulturminnesok ? (
    <Link
      href={km.linkKulturminnesok}
      target="_blank"
      rel="noopener noreferrer"
      display="block"
      color="inherit"
      borderRadius="sm"
      _hover={{ bg: 'gray.50', textDecoration: 'none' }}
      title={t('localities.kulturminner.openLink')}
    >
      {body}
    </Link>
  ) : (
    body
  );
};

export const KulturminnerSection = ({
  result,
  error,
}: {
  result: KulturminnerResult | null;
  error: boolean;
}) => {
  const { t } = useTranslation();

  if (error) {
    return (
      <Text fontSize="xs" color="gray.500">
        {t('localities.kulturminner.error')}
      </Text>
    );
  }

  if (!result) {
    return (
      <Flex align="center" gap={2}>
        <Spinner size="xs" />
        <Text fontSize="xs" color="gray.500">
          {t('localities.kulturminner.loading')}
        </Text>
      </Flex>
    );
  }

  if (result.items.length === 0) {
    return (
      <Text fontSize="xs" color="gray.600">
        {t('localities.kulturminner.empty')}
      </Text>
    );
  }

  return (
    <Stack gap={0} maxH="200px" overflowY="auto">
      {result.items.map((km, i) => (
        <Box key={i} borderBottomWidth="1px" borderColor="gray.100">
          <KulturminneRow km={km} />
        </Box>
      ))}
    </Stack>
  );
};
