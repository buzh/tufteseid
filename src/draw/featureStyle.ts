import type { GeoJsonProperties } from 'geojson';
import type { Color } from 'ol/color';
import type { ColorLike, PatternDescriptor } from 'ol/colorlike';
import { Fill, Stroke, Style, Text } from 'ol/style';
import type { PointIcon } from './drawControls/hooks/drawSettings';

/*
 * Reading a drawn feature's appearance back out of its stored properties.
 *
 * This is the *load* half of the round-trip that `serializeDrawLayer.ts`
 * writes: a funn's geometry is a GeoJSON FeatureCollection whose features
 * carry their own style, so reopening a lokalitet redraws it as it was drawn.
 * Both the editable draw layer (`drawControls/hooks/drawSettings.ts`) and the
 * read-only funn layer (`localities/funnLayer.ts`) come through here.
 *
 * It used to live in `dialogs/import/utils.ts` alongside the GPX/GeoJSON file
 * importer, which made it look like import-only code — it was not, and the
 * importer is gone.
 */

export type StyleForStorage = {
  fill: { color: Color | ColorLike | PatternDescriptor | null };
  stroke: {
    color: Color | ColorLike | undefined;
    width: number | undefined;
    lineDash?: number[];
  };
  text?: {
    // `text` is the current shape; `value` is read for older records.
    text?: string | undefined;
    value?: string | undefined;
    font: string | undefined;
    fillColor: Color | ColorLike | PatternDescriptor | null;
    backgroundFillColor: Color | ColorLike | PatternDescriptor | null;
    stroke?: {
      color: Color | ColorLike | undefined;
      width: number | undefined;
    };
  };
};

export const getStyleFromProperties = (props: GeoJsonProperties) => {
  if (props == null) {
    return null;
  }
  const styleFromProps = props.style as StyleForStorage | undefined;
  if (styleFromProps == null) {
    return null;
  }

  const fill = styleFromProps.fill?.color
    ? new Fill({ color: styleFromProps.fill.color })
    : undefined;

  const stroke = styleFromProps.stroke?.color
    ? new Stroke({
        color: styleFromProps.stroke.color,
        width: styleFromProps.stroke.width ?? 2,
        lineDash: styleFromProps.stroke.lineDash,
      })
    : undefined;

  const textValue =
    (styleFromProps.text as { text?: string; value?: string })?.text ??
    (styleFromProps.text as { text?: string; value?: string })?.value;
  const text = textValue
    ? new Text({
        text: textValue,
        font: styleFromProps.text?.font ?? '16px sans-serif',
        fill: styleFromProps.text?.fillColor
          ? new Fill({ color: styleFromProps.text.fillColor })
          : new Fill({ color: '#000000' }),
        stroke: styleFromProps.text?.stroke?.color
          ? new Stroke({
              color: styleFromProps.text.stroke.color,
              width: styleFromProps.text.stroke.width ?? 1,
            })
          : undefined,
        backgroundFill: styleFromProps.text?.backgroundFillColor
          ? new Fill({ color: styleFromProps.text.backgroundFillColor })
          : undefined,
        offsetY: -15,
        textAlign: 'center',
        textBaseline: 'bottom',
      })
    : undefined;

  if (!fill && !stroke && !text) {
    return null;
  }

  return new Style({
    fill,
    stroke,
    text,
  });
};

export const getOverlayIconFromProperties = (
  properties: GeoJsonProperties,
): PointIcon | null => {
  const iconFromProps = properties?.overlayIcon as PointIcon | null;
  return iconFromProps;
};

export const getCircleRadiusFromProperties = (
  properties: GeoJsonProperties,
): number | null => {
  const radiusFromProps = properties?.radius as number | null;
  return radiusFromProps;
};
