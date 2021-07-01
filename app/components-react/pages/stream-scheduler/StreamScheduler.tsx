import React, { MouseEvent } from 'react';
import { IStreamEvent } from '../../../services/streaming';
import moment, { Moment } from 'moment';
import css from './StreamScheduler.m.less';
import cx from 'classnames';
import { Button, Calendar, message, Modal, Row, Col, Spin } from 'antd';
import { YoutubeEditStreamInfo } from '../../windows/go-live/platforms/YoutubeEditStreamInfo';
import { $t } from '../../../services/i18n';
import FacebookEditStreamInfo from '../../windows/go-live/platforms/FacebookEditStreamInfo';
import { ListInput, TimeInput } from '../../shared/inputs';
import Form, { useForm } from '../../shared/inputs/Form';
import { mutation } from '../../store';
import { Services } from '../../service-provider';
import { useModule } from '../../hooks/useModule';
import { getPlatformService, TPlatform } from '../../../services/platforms';
import {
  IYoutubeLiveBroadcast,
  IYoutubeStartStreamOptions,
} from '../../../services/platforms/youtube';
import {
  FacebookService,
  IFacebookLiveVideo,
  IFacebookLiveVideoExtended,
  IFacebookStartStreamOptions,
  IFacebookUpdateVideoOptions,
} from '../../../services/platforms/facebook';
import { assertIsDefined, getDefined } from '../../../util/properties-type-guards';
import { cloneDeep, pick } from 'lodash';
import { FormInstance } from 'antd/lib/form';
import { confirm } from '../../modals';
import { IStreamError } from '../../../services/streaming/stream-error';

interface ISchedulerPlatformSettings extends Partial<Record<TPlatform, Object>> {
  youtube?: IYoutubeStartStreamOptions;
  facebook?: IFacebookStartStreamOptions;
}

class StreamSchedulerModule {
  state = {
    isLoading: false,
    isEventsLoaded: false,
    events: [] as IStreamEvent[],
    isModalVisible: false,
    selectedEventId: '',
    time: 0,
    selectedPlatform: this.platforms[0],
    platformSettings: this.defaultPlatformSettings,
  };

  init() {
    this.loadEvents();
  }

  get defaultPlatformSettings(): ISchedulerPlatformSettings {
    const defaultSettings = {
      facebook: cloneDeep(Services.FacebookService.state.settings) as IFacebookUpdateVideoOptions,
      youtube: cloneDeep(Services.YoutubeService.state.settings),
    };
    defaultSettings.youtube.broadcastId = '';
    defaultSettings.facebook.liveVideoId = '';
    return defaultSettings;
  }

  // antd form instance
  public form: FormInstance;

  setForm(form: FormInstance) {
    this.form = form;
  }

  get streamingView() {
    return Services.StreamingService.views;
  }

  get selectedEvent() {
    return this.state.events.find(ev => this.state.selectedEventId === ev.id);
  }

  private async loadEvents() {
    this.reset();

    // load fb and yt events simultaneously
    const events: IStreamEvent[] = [];
    const [fbEvents, ytEvents] = await Promise.all([this.loadFbEvents(), this.loadYTBEvents()]);

    // convert fb and yt events to the unified IStreamEvent format
    ytEvents.forEach(ytEvent => {
      events.push(convertYTBroadcastToEvent(ytEvent));
    });

    fbEvents.forEach(fbEvent => {
      events.push(convertFBLiveVideoToEvent(fbEvent));
    });
    this.setEvents(events);
  }

  private async loadYTBEvents() {
    if (!this.platforms.includes('youtube')) return [];
    const ytActions = Services.YoutubeService.actions;
    await ytActions.return.prepopulateInfo();
    return await ytActions.return.fetchBroadcasts();
  }

  private async loadFbEvents() {
    if (!this.platforms.includes('facebook')) return [];
    const fbActions = Services.FacebookService.actions;
    await fbActions.return.prepopulateInfo();
    return fbActions.return.fetchAllVideos();
  }

  get platforms(): TPlatform[] {
    return this.streamingView.linkedPlatforms.filter(platform =>
      this.streamingView.supports('stream-schedule', [platform]),
    );
  }

  get isUpdateMode() {
    return !!this.state.selectedEventId;
  }

  get fbSettings(): IFacebookStartStreamOptions {
    return getDefined(this.state.platformSettings.facebook);
  }

  get ytSettings(): IYoutubeStartStreamOptions {
    return getDefined(this.state.platformSettings.youtube);
  }

  getPlatformDisplayName = this.streamingView.getPlatformDisplayName;

  @mutation()
  showNewEventModal(platform: TPlatform, selectedTime?: Moment) {
    const today = new Date().setHours(0, 0, 0, 0);
    const time = selectedTime?.valueOf() || this.state.time;
    const isPastDate = time < today;
    if (isPastDate) {
      message.error($t('You can not schedule to a past date'));
      return;
    }
    this.state.selectedPlatform = platform;
    this.state.isModalVisible = true;
    this.setTime(time.valueOf());
  }

  async showEditEventModal(eventId: string) {
    const event = getDefined(this.state.events.find(ev => eventId === ev.id));
    if (event.platform === 'youtube') {
      const ytSettings = await Services.YoutubeService.actions.return.fetchStartStreamOptionsForBroadcast(
        event.id,
      );
      this.SHOW_EDIT_EVENT_MODAL(event, ytSettings);
    } else {
      const fbDestination = getDefined(event.facebook);
      const fbSettings = await Services.FacebookService.actions.return.fetchStartStreamOptionsForVideo(
        event.id,
        fbDestination.destinationType,
        fbDestination.destinationId,
      );
      this.SHOW_EDIT_EVENT_MODAL(event, fbSettings);
    }
  }

  async validate() {
    try {
      await this.form.validateFields();
      return true;
    } catch (e: unknown) {
      message.error($t('Invalid settings. Please check the form'));
      return false;
    }
  }

  /**
   * Submit form and update or create an new event
   */
  async submit() {
    // validate form
    try {
      await this.form.validateFields();
    } catch (e: unknown) {
      message.error($t('Invalid settings. Please check the form'));
      return;
    }

    this.showLoader();

    if (this.isUpdateMode) {
      this.saveExistingStream();
    } else {
      this.saveNewStream();
    }
  }

  private async saveExistingStream() {
    const { selectedPlatform, selectedEventId } = this.state;
    const streamSettings = getDefined(this.state.platformSettings[selectedPlatform]);

    if (selectedPlatform === 'youtube') {
      // update YT event
      const video = await Services.YoutubeService.actions.return.updateBroadcast(
        selectedEventId,
        streamSettings as IYoutubeStartStreamOptions,
      );
      this.setEvent(video.id, convertYTBroadcastToEvent(video));
    } else {
      // update FB event
      const event = getDefined(this.selectedEvent);
      const fbOptions = getDefined(event.facebook);
      let video!: IFacebookLiveVideo;
      try {
        video = await Services.FacebookService.actions.return.updateLiveVideo(
          selectedEventId,
          streamSettings as IFacebookUpdateVideoOptions,
        );
      } catch (e: unknown) {
        this.handleError(e as IStreamError);
        return;
      }
      this.setEvent(video.id, convertFBLiveVideoToEvent({ ...video, ...fbOptions }));
    }
    this.closeModal();
  }

  private async saveNewStream() {
    const { selectedPlatform, time } = this.state;
    const streamSettings = getDefined(this.state.platformSettings[selectedPlatform]);
    const service = getPlatformService(selectedPlatform);

    assertIsDefined(service.scheduleStream);
    let video!: IFacebookLiveVideo | IYoutubeLiveBroadcast;
    try {
      video = await service.scheduleStream(time, streamSettings);
    } catch (e: unknown) {
      this.handleError(e as IStreamError);
      return;
    }
    let event: IStreamEvent;
    if (selectedPlatform === 'youtube') {
      event = convertYTBroadcastToEvent(video as IYoutubeLiveBroadcast);
    } else {
      assertIsDefined(this.fbSettings);
      const fbSettings = getDefined(this.fbSettings);
      const destinationId = (service as FacebookService).views.getDestinationId(fbSettings);
      event = convertFBLiveVideoToEvent({
        ...video,
        destinationType: fbSettings.destinationType,
        destinationId,
      } as IFacebookLiveVideoExtended);
    }
    this.setEvent(video.id, event);
    this.closeModal();
  }

  private handleError(err: IStreamError) {
    if (this.state.selectedPlatform === 'facebook') {
      message.error(
        $t(
          'Please schedule no further than 7 days in advance and no sooner than 10 minutes in advance.',
        ),
      );
    } else {
      message.error($t('Can not schedule the stream for the given date/time'));
    }
    this.hideLoader();
  }

  remove() {
    const { selectedPlatform, selectedEventId } = this.state;
    this.showLoader();
    if (selectedPlatform === 'youtube') {
      Services.YoutubeService.actions.return.removeBroadcast(selectedEventId);
    } else {
      const event = getDefined(this.selectedEvent);
      const fbOptions = getDefined(event.facebook);
      Services.FacebookService.actions.return.removeLiveVideo(selectedEventId, fbOptions);
    }
    this.REMOVE_EVENT(selectedEventId);
    this.closeModal();
  }

  @mutation()
  private SHOW_EDIT_EVENT_MODAL(
    event: IStreamEvent,
    platformSettings: IYoutubeStartStreamOptions | IFacebookStartStreamOptions,
  ) {
    this.state.selectedEventId = event.id;
    this.state.selectedPlatform = event.platform;
    this.state.platformSettings[event.platform] = platformSettings as any;
    this.state.isModalVisible = true;
    this.state.time = event.date;
  }

  @mutation()
  closeModal() {
    this.state.selectedEventId = '';
    this.state.isModalVisible = false;
    this.state.platformSettings = this.defaultPlatformSettings;
    this.state.isLoading = false;
  }

  @mutation()
  updatePlatform<T extends TPlatform>(platform: T, patch: ISchedulerPlatformSettings[T]) {
    Object.assign(this.state.platformSettings[platform], patch);
  }

  @mutation()
  setTime(time: number) {
    this.state.time = time;
    if (this.state.selectedPlatform === 'facebook') {
      getDefined(this.state.platformSettings.facebook).plannedStartTime = time;
    } else {
      getDefined(this.state.platformSettings.youtube).scheduledStartTime = time;
    }
  }

  @mutation()
  private reset() {
    this.state.events = [];
    this.state.platformSettings = this.defaultPlatformSettings;
  }

  @mutation()
  private setEvents(events: IStreamEvent[]) {
    console.log('events are loaded', events);
    this.state.isEventsLoaded = true;
    this.state.events = events;
  }

  @mutation()
  private addEvent(event: IStreamEvent) {
    this.state.events.push(event);
  }

  @mutation()
  private setEvent(id: string, event: IStreamEvent) {
    const ind = this.state.events.findIndex(ev => ev.id === id);
    this.state.events.splice(ind, 1, event);
  }

  @mutation()
  private REMOVE_EVENT(id: string) {
    this.state.events = this.state.events.filter(ev => ev.id !== id);
  }

  @mutation()
  private showLoader() {
    this.state.isLoading = true;
  }

  @mutation()
  private hideLoader() {
    this.state.isLoading = false;
  }
}

function useStreamScheduler() {
  return useModule(StreamSchedulerModule).select();
}

/**
 * StreamScheduler page
 */
export default function StreamScheduler() {
  const { isEventsLoaded, setForm } = useStreamScheduler();

  const form = useForm();
  setForm(form);

  return (
    <div className={cx(css.streamSchedulerPage)}>
      <Spin tip="Loading..." spinning={!isEventsLoaded}>
        <SchedulerCalendar />
      </Spin>
      <EventSettingsModal />
    </div>
  );
}

function SchedulerCalendar() {
  const { showEditEventModal, showNewEventModal, selectedPlatform, events } = useStreamScheduler();

  function renderEvent(event: IStreamEvent) {
    const time = moment(event.date).format('hh:mma');
    return (
      <p
        key={event.id}
        className={cx({
          [css.event]: true,
          [css.eventFacebook]: event.platform === 'facebook',
          [css.eventYoutube]: event.platform === 'youtube',
        })}
        onClick={ev => {
          ev.stopPropagation();
          showEditEventModal(event.id);
        }}
      >
        <span className={css.eventTime}>{time}</span> &nbsp;
        <span className={css.eventTitle}>{event.title}</span>
      </p>
    );
  }

  function onDaySelectHandler(date: Moment) {
    showNewEventModal(selectedPlatform, date);
  }

  function onClick(event: MouseEvent) {
    const $td = event.target!['closest']('td');
    if (!$td) return;
    $td.querySelector('[data-role="day"]')!['click']();
  }

  function dateCellRender(date: Moment) {
    const start = moment(date).startOf('day');
    const end = moment(date).endOf('day');

    const dayEvents = events
      .filter(ev => {
        return moment(ev.date).isBetween(start, end);
      })
      .sort((ev1, ev2) => ev1.date - ev2.date);

    return (
      <div data-role="day" onClick={() => onDaySelectHandler(date)}>
        {dayEvents.map(renderEvent)}
      </div>
    );
  }

  return (
    <div onClick={onClick}>
      <Calendar
        dateCellRender={dateCellRender}
        validRange={[moment().subtract(12, 'month'), moment().add(1, 'month')]}
      />
    </div>
  );
}

function EventSettingsModal() {
  const {
    isUpdateMode,
    time,
    isModalVisible,
    submit,
    closeModal,
    form,
    isLoading,
    selectedPlatform,
    platforms,
    getPlatformDisplayName,
    showNewEventModal,
    setTime,
    ytSettings,
    fbSettings,
    updatePlatform,
  } = useStreamScheduler();

  const canChangePlatform = !isUpdateMode;
  const date = moment(time).calendar();
  const title = isUpdateMode
    ? $t('Update Scheduled Stream for %{date}', { date })
    : $t('Schedule Stream for %{date}', { date });

  return (
    <Modal
      title={title}
      visible={isModalVisible}
      onOk={submit}
      onCancel={closeModal}
      afterClose={closeModal}
      destroyOnClose={true}
      footer={<EventButtons />}
      getContainer={`.${css.streamSchedulerPage}`}
    >
      <Form form={form}>
        <Spin spinning={isLoading}>
          {canChangePlatform && (
            <ListInput
              label={$t('Platform')}
              value={selectedPlatform}
              options={platforms.map(platform => ({
                value: platform,
                label: getPlatformDisplayName(platform),
              }))}
              onChange={platform => showNewEventModal(platform)}
            />
          )}

          <TimeInput label={$t('Time')} value={time} onChange={setTime} />

          {selectedPlatform === 'youtube' && (
            <YoutubeEditStreamInfo
              layoutMode="singlePlatform"
              isUpdateMode={isUpdateMode}
              isScheduleMode={true}
              value={ytSettings}
              onChange={newSettings => updatePlatform('youtube', newSettings)}
            />
          )}
          {selectedPlatform === 'facebook' && (
            <FacebookEditStreamInfo
              layoutMode="singlePlatform"
              isUpdateMode={isUpdateMode}
              isScheduleMode={true}
              value={fbSettings}
              onChange={newSettings => updatePlatform('facebook', newSettings)}
            />
          )}
        </Spin>
      </Form>
    </Modal>
  );
}

function EventButtons() {
  const { selectedEvent, remove, submit, isLoading } = useStreamScheduler();
  const shouldShowSave = !!selectedEvent;
  const shouldShowRemove = selectedEvent && selectedEvent.status === 'scheduled';
  const shouldShowSchedule = !selectedEvent;

  async function onDeleteClick() {
    if (await confirm($t('Delete the event?'))) remove();
  }

  return (
    <Row>
      <Col flex={'50%'} style={{ textAlign: 'left' }}>
        {/* DELETE BUTTON */}
        {shouldShowRemove && (
          <Button danger onClick={onDeleteClick}>
            {$t('Delete')}
          </Button>
        )}
      </Col>
      <Col flex={'50%'}>
        {/*/!* GO LIVE BUTTON *!/*/}
        {/*{shouldShowGoLive && <Button type="primary">{$t('Go Live')}</Button>}*/}

        {/* SAVE BUTTON */}
        {shouldShowSave && (
          <Button type="primary" onClick={submit} disabled={isLoading}>
            {$t('Save')}
          </Button>
        )}

        {/* SCHEDULE BUTTON */}
        {shouldShowSchedule && (
          <Button type="primary" onClick={submit} disabled={isLoading}>
            {$t('Schedule')}
          </Button>
        )}
      </Col>
    </Row>
  );
}

function convertYTBroadcastToEvent(ytBroadcast: IYoutubeLiveBroadcast): IStreamEvent {
  let status: IStreamEvent['status'] = 'completed';
  if (
    ytBroadcast.status.lifeCycleStatus === 'created' ||
    ytBroadcast.status.lifeCycleStatus === 'ready'
  ) {
    status = 'scheduled';
  }

  return {
    platform: 'youtube',
    id: ytBroadcast.id,
    date: new Date(
      ytBroadcast.snippet.scheduledStartTime || ytBroadcast.snippet.actualStartTime,
    ).valueOf(),
    title: ytBroadcast.snippet.title,
    status,
  };
}

function convertFBLiveVideoToEvent(fbLiveVideo: IFacebookLiveVideoExtended): IStreamEvent {
  return {
    platform: 'facebook',
    id: fbLiveVideo.id,
    date: new Date(fbLiveVideo.planned_start_time || fbLiveVideo.broadcast_start_time).valueOf(),
    title: fbLiveVideo.title,
    status: 'scheduled',
    facebook: {
      destinationType: fbLiveVideo.destinationType,
      destinationId: fbLiveVideo.destinationId,
    },
  };
}
