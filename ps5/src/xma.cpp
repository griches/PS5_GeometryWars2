/*
 * Geometry Wars 2 for the PlayStation 5 - the ffmpeg runs of geow2's extractor, in the title.
 *
 * geow2's extractor (vendor/geow2/src/extract/audio.cpp) turns each XMA1 wave
 * of the package's sound banks into PCM by running the ffmpeg program:
 *
 *   ffmpeg -hide_banner -loglevel error -y -i 'IN.xma.tmp' -c:a pcm_s16le 'OUT.wav'
 *
 * and first asks whether one is there (ffmpeg -hide_banner -version). A title
 * cannot run a program, so the console's build hands every command to
 * ps5_ffmpeg_run (its setup's ExtractHooks::run): the version check answers
 * yes, and a conversion is done here with FFmpeg's own libraries (WAV
 * demuxer, XMA1 decoder: tools/setup-ffmpeg.sh). The samples are the
 * program's: float to 16 bits as its resampler converts them, rounded and
 * clipped.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
}

namespace {

// The command's arguments: words, or 'quoted' as the extractor quotes them
// for a POSIX shell (a quote inside is '\'').
std::vector<std::string> split(const std::string& command)
{
   std::vector<std::string> words;
   std::string word;
   bool in_word = false;
   for (size_t i = 0; i < command.size(); i++) {
      const char c = command[i];
      if (c == '\'') {
         in_word = true;
         for (i++; i < command.size() && command[i] != '\''; i++)
            word.push_back(command[i]);
      } else if (c == '\\' && i + 1 < command.size()) {
         in_word = true;
         word.push_back(command[++i]);
      } else if (c == ' ') {
         if (in_word)
            words.push_back(word);
         word.clear();
         in_word = false;
      } else {
         in_word = true;
         word.push_back(c);
      }
   }
   if (in_word)
      words.push_back(word);
   return words;
}

void put16(std::vector<uint8_t>& b, uint32_t v)
{
   b.push_back(uint8_t(v));
   b.push_back(uint8_t(v >> 8));
}

void put32(std::vector<uint8_t>& b, uint32_t v)
{
   for (int i = 0; i < 4; i++)
      b.push_back(uint8_t(v >> (8 * i)));
}

void put_tag(std::vector<uint8_t>& b, const char* tag)
{
   b.insert(b.end(), tag, tag + 4);
}

int16_t to_s16(float x)
{
   const long v = lrintf(x * 32768.0f);
   return int16_t(v < -32768 ? -32768 : v > 32767 ? 32767 : v);
}

// IN (any audio FFmpeg reads) as 16-bit PCM WAV in OUT; 0 when it worked
int decode(const std::string& in, const std::string& out)
{
   AVFormatContext* format = nullptr;
   if (avformat_open_input(&format, in.c_str(), nullptr, nullptr) < 0)
      return 1;
   const AVCodec* codec = nullptr;
   AVCodecContext* context = nullptr;
   AVPacket* packet = av_packet_alloc();
   AVFrame* frame = av_frame_alloc();
   std::vector<int16_t> samples;
   int stream = -1, channels = 0, rate = 0, failed = 1;
   if (avformat_find_stream_info(format, nullptr) < 0 ||
       (stream = av_find_best_stream(format, AVMEDIA_TYPE_AUDIO, -1, -1, &codec, 0)) < 0 ||
       (context = avcodec_alloc_context3(codec)) == nullptr ||
       avcodec_parameters_to_context(context, format->streams[stream]->codecpar) < 0 ||
       avcodec_open2(context, codec, nullptr) < 0)
      goto done;
   // Every packet, then the decoder drained
   for (bool more = true; more;) {
      int sent;
      if (av_read_frame(format, packet) >= 0) {
         if (packet->stream_index != stream) {
            av_packet_unref(packet);
            continue;
         }
         sent = avcodec_send_packet(context, packet);
         av_packet_unref(packet);
      } else {
         sent = avcodec_send_packet(context, nullptr);
         more = false;
      }
      if (sent < 0 && sent != AVERROR(EAGAIN) && sent != AVERROR_EOF)
         goto done;
      while (avcodec_receive_frame(context, frame) >= 0) {
         channels = frame->ch_layout.nb_channels;
         rate = frame->sample_rate;
         const int n = frame->nb_samples;
         for (int i = 0; i < n; i++) {
            for (int ch = 0; ch < channels; ch++) {
               float x = 0.0f;
               switch (frame->format) {
               case AV_SAMPLE_FMT_FLTP: x = reinterpret_cast<const float*>(frame->extended_data[ch])[i]; break;
               case AV_SAMPLE_FMT_FLT: x = reinterpret_cast<const float*>(frame->data[0])[i * channels + ch]; break;
               case AV_SAMPLE_FMT_S16P:
                  samples.push_back(reinterpret_cast<const int16_t*>(frame->extended_data[ch])[i]);
                  continue;
               case AV_SAMPLE_FMT_S16:
                  samples.push_back(reinterpret_cast<const int16_t*>(frame->data[0])[i * channels + ch]);
                  continue;
               default: goto done;
               }
               samples.push_back(to_s16(x));
            }
         }
         av_frame_unref(frame);
      }
   }
   if (channels > 0 && rate > 0) {
      const uint32_t bytes = uint32_t(samples.size() * 2);
      std::vector<uint8_t> wav;
      put_tag(wav, "RIFF");
      put32(wav, 4 + 8 + 16 + 8 + bytes);
      put_tag(wav, "WAVE");
      put_tag(wav, "fmt ");
      put32(wav, 16);
      put16(wav, 1);
      put16(wav, uint32_t(channels));
      put32(wav, uint32_t(rate));
      put32(wav, uint32_t(rate * channels * 2));
      put16(wav, uint32_t(channels * 2));
      put16(wav, 16);
      put_tag(wav, "data");
      put32(wav, bytes);
      const uint8_t* p = reinterpret_cast<const uint8_t*>(samples.data());
      wav.insert(wav.end(), p, p + bytes);
      if (FILE* f = std::fopen(out.c_str(), "wb")) {
         failed = std::fwrite(wav.data(), 1, wav.size(), f) != wav.size();
         failed |= std::fclose(f) != 0;
      }
   }
done:
   av_frame_free(&frame);
   av_packet_free(&packet);
   avcodec_free_context(&context);
   avformat_close_input(&format);
   return failed;
}

} // namespace

// The extractor's command runner on the console (geow2.patch: setup.cpp's base_hooks)
int ps5_ffmpeg_run(const std::string& command)
{
   const std::vector<std::string> args = split(command);
   for (const std::string& a : args)
      if (a == "-version")
         return 0;
   std::string in;
   for (size_t i = 0; i + 1 < args.size(); i++)
      if (args[i] == "-i")
         in = args[i + 1];
   if (in.empty() || args.size() < 2)
      return 1;
   const int rc = decode(in, args.back());
   if (rc != 0)
      std::fprintf(stderr, "xma: could not decode %s\n", in.c_str());
   return rc;
}
