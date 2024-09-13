import React from 'react';
import Form from '../../../shared/inputs/Form';
import { $t } from '../../../../services/i18n';
import { Services } from '../../../service-provider';
import { Button, Tooltip } from 'antd';
import InputWrapper from '../../../shared/inputs/InputWrapper';
import PlatformSettingsLayout, { IPlatformComponentParams } from './PlatformSettingsLayout';
import * as remote from '@electron/remote';
import { CommonPlatformFields } from '../CommonPlatformFields';
import { ITikTokStartStreamOptions } from 'services/platforms/tiktok';
import { TextInput, createBinding } from 'components-react/shared/inputs';
import InfoBanner from 'components-react/shared/InfoBanner';
import GameSelector from '../GameSelector';
import { EDismissable } from 'services/dismissables';

/**
 * @remark The filename for this component is intentionally not consistent with capitalization to preserve the commit history
 */
export function TikTokEditStreamInfo(p: IPlatformComponentParams<'tiktok'>) {
  const { TikTokService } = Services;
  const ttSettings = p.value;
  const approved = TikTokService.scope === 'approved';
  const denied = TikTokService.scope === 'denied' && !TikTokService.promptReapply;

  function updateSettings(patch: Partial<ITikTokStartStreamOptions>) {
    p.onChange({ ...ttSettings, ...patch });
  }

  const bind = createBinding(ttSettings, updatedSettings => updateSettings(updatedSettings));

  return (
    <Form name="tiktok-settings">
      <PlatformSettingsLayout
        layoutMode={p.layoutMode}
        commonFields={
          <CommonPlatformFields
            key="common"
            platform="tiktok"
            layoutMode={p.layoutMode}
            value={ttSettings}
            onChange={updateSettings}
          />
        }
        requiredFields={<div key="empty-tiktok" />}
      />
      {approved && <GameSelector key="optional" platform={'tiktok'} {...bind.game} />}
      {!approved && <TikTokEnterCredentialsFormInfo {...p} denied={denied} />}
    </Form>
  );
}

export function TikTokEnterCredentialsFormInfo(
  p: IPlatformComponentParams<'tiktok'> & { denied: boolean },
) {
  const bind = createBinding(p.value, updatedSettings =>
    p.onChange({ ...p.value, ...updatedSettings }),
  );

  return (
    <>
      <TextInput
        label={
          <Tooltip title={$t('Generate with "Locate my Stream Key"')} placement="right">
            {$t('TikTok Server URL')}
            <i className="icon-information" style={{ marginLeft: '5px' }} />
          </Tooltip>
        }
        required
        {...bind.serverUrl}
      />
      <TextInput
        label={
          <Tooltip title={$t('Generate with "Locate my Stream Key"')} placement="right">
            {$t('TikTok Stream Key')}
            <i className="icon-information" style={{ marginLeft: '5px' }} />
          </Tooltip>
        }
        required
        {...bind.streamKey}
      />
      <InputWrapper
        extra={
          <div style={{ display: 'flex', flexDirection: 'column' }} className="input-extra">
            {p.denied ? <TikTokDenied /> : <TikTokInfo />}
          </div>
        }
      >
        <TikTokButtons denied={p.denied} />
      </InputWrapper>
    </>
  );
}

function TikTokDenied() {
  return (
    <InfoBanner
      id="tiktok-denied"
      message={$t('TikTok Live Access not granted. Click here to learn more.')}
      type="info"
      onClick={() => {
        openConfirmation();
        Services.UsageStatisticsService.recordAnalyticsEvent('TikTokApplyPrompt', {
          component: 'NotGrantedBannerDismissed',
        });
      }}
      dismissableKey={EDismissable.TikTokRejected}
    />
  );
}

function TikTokInfo() {
  return (
    <>
      <a id="tiktok-faq" onClick={() => openInfoPage()}>
        {$t('Go live to TikTok with a single click. Click here to learn more.')}
      </a>
      <InfoBanner
        id="tiktok-info"
        message={$t("Approvals are solely at TikTok's discretion.")}
        type="info"
        style={{ marginTop: '5px', marginBottom: '5px' }}
      />
    </>
  );
}

function TikTokButtons(p: { denied: boolean }) {
  const status = Services.TikTokService.promptApply ? 'prompted' : 'not-prompted';
  const component = p.denied ? 'ReapplyButton' : 'ApplyButton';
  const text = p.denied
    ? $t('Reapply for TikTok Live Permission')
    : $t('Apply for TikTok Live Permission');

  const data = {
    component,
    status: !p.denied ? status : undefined,
  };

  return (
    <>
      {!p.denied && (
        <Button id="tiktok-locate-key" onClick={openProducer} style={{ marginBottom: '10px' }}>
          {$t('Locate my Stream Key')}
        </Button>
      )}
      <Button
        id="tiktok-application"
        onClick={() => {
          Services.UsageStatisticsService.recordAnalyticsEvent('TikTokApplyPrompt', data);
          openApplicationInfoPage();
        }}
        style={{
          width: '100%',
          marginBottom: '10px',
          background: 'var(--tiktok-btn)',
          color: 'var(--black)',
        }}
      >
        {text}
      </Button>
    </>
  );
}

function openInfoPage() {
  remote.shell.openExternal(Services.TikTokService.infoUrl);
}

function openApplicationInfoPage() {
  remote.shell.openExternal(Services.TikTokService.applicationUrl);
}

function openProducer() {
  remote.shell.openExternal(Services.TikTokService.legacyDashboardUrl);
}

function openConfirmation() {
  remote.shell.openExternal(Services.TikTokService.confirmationUrl);
}
