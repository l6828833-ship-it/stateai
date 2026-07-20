import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { slugify } from "@shared/blog";
import {
  ExternalLink,
  FileText,
  FolderTree,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

type BlogView = "posts" | "categories" | "settings";

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

// ============================ Post editor ============================

interface PostFormState {
  id?: number;
  title: string;
  slug: string;
  categoryId: number | "";
  status: "draft" | "published";
  excerpt: string;
  content: string;
  coverImageUrl: string;
  coverImageAlt: string;
  authorName: string;
  seoTitle: string;
  seoDescription: string;
  canonicalUrl: string;
  ogImageUrl: string;
  metaKeywords: string;
  tags: string;
}

const emptyPost: PostFormState = {
  title: "",
  slug: "",
  categoryId: "",
  status: "draft",
  excerpt: "",
  content: "",
  coverImageUrl: "",
  coverImageAlt: "",
  authorName: "",
  seoTitle: "",
  seoDescription: "",
  canonicalUrl: "",
  ogImageUrl: "",
  metaKeywords: "",
  tags: "",
};

function PostEditor({
  open,
  onOpenChange,
  editingId,
  categories,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId: number | null;
  categories: Array<{ id: number; name: string; slug: string }>;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<PostFormState>(emptyPost);
  const [slugTouched, setSlugTouched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const detailQuery = trpc.blog.adminGetPost.useQuery(
    { id: editingId ?? 0 },
    { enabled: open && editingId !== null }
  );
  const createMutation = trpc.blog.createPost.useMutation();
  const updateMutation = trpc.blog.updatePost.useMutation();
  const uploadMutation = trpc.blog.uploadImage.useMutation();

  useEffect(() => {
    if (!open) return;
    if (editingId === null) {
      setForm({ ...emptyPost, categoryId: categories[0]?.id ?? "" });
      setSlugTouched(false);
    }
  }, [open, editingId, categories]);

  useEffect(() => {
    if (detailQuery.data && editingId !== null) {
      const p = detailQuery.data;
      setForm({
        id: p.id,
        title: p.title,
        slug: p.slug,
        categoryId: p.categoryId,
        status: p.status,
        excerpt: p.excerpt ?? "",
        content: p.content,
        coverImageUrl: p.coverImageUrl ?? "",
        coverImageAlt: p.coverImageAlt ?? "",
        authorName: p.authorName ?? "",
        seoTitle: p.seoTitle ?? "",
        seoDescription: p.seoDescription ?? "",
        canonicalUrl: p.canonicalUrl ?? "",
        ogImageUrl: p.ogImageUrl ?? "",
        metaKeywords: p.metaKeywords ?? "",
        tags: p.tags ?? "",
      });
      setSlugTouched(true);
    }
  }, [detailQuery.data, editingId]);

  const set = <K extends keyof PostFormState>(key: K, value: PostFormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const effectiveSlug = slugTouched ? form.slug : slugify(form.title);
  const category = categories.find(c => c.id === form.categoryId);
  const previewUrl =
    category && effectiveSlug ? `/${category.slug}/${effectiveSlug}` : null;

  const handleCoverUpload = async (file: File) => {
    setUploading(true);
    try {
      const base64Data = await fileToBase64(file);
      const { url } = await uploadMutation.mutateAsync({ base64Data });
      set("coverImageUrl", url);
      toast.success("Image uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (status: "draft" | "published") => {
    if (!form.title.trim()) return toast.error("Add a title first");
    if (!form.categoryId) return toast.error("Choose a category");
    if (!form.content.trim()) return toast.error("Add some content first");
    const payload = {
      title: form.title.trim(),
      slug: (slugTouched ? form.slug : "") || undefined,
      categoryId: Number(form.categoryId),
      status,
      excerpt: form.excerpt || undefined,
      content: form.content,
      coverImageUrl: form.coverImageUrl || undefined,
      coverImageAlt: form.coverImageAlt || undefined,
      authorName: form.authorName || undefined,
      seoTitle: form.seoTitle || undefined,
      seoDescription: form.seoDescription || undefined,
      canonicalUrl: form.canonicalUrl || undefined,
      ogImageUrl: form.ogImageUrl || undefined,
      metaKeywords: form.metaKeywords || undefined,
      tags: form.tags || undefined,
    };
    try {
      if (form.id) {
        await updateMutation.mutateAsync({ id: form.id, ...payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      toast.success(
        status === "published" ? "Post published" : "Draft saved"
      );
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save post");
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  const loading = editingId !== null && detailQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] w-[min(96vw,60rem)] !max-w-none overflow-y-auto rounded-3xl bg-white p-0">
        <DialogTitle className="sr-only">
          {form.id ? "Edit post" : "New post"}
        </DialogTitle>
        {loading ? (
          <div className="flex min-h-80 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="p-6 sm:p-8">
            <h2 className="font-display text-xl">
              {form.id ? "Edit post" : "Write a new post"}
            </h2>
            {previewUrl && (
              <p className="mt-1 text-xs text-zinc-400">
                URL: <code className="rounded bg-zinc-100 px-1.5 py-0.5">{previewUrl}</code>
              </p>
            )}

            <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
              {/* Main column */}
              <div className="space-y-4">
                <div>
                  <Label>Title</Label>
                  <Input
                    value={form.title}
                    onChange={e => set("title", e.target.value)}
                    placeholder="10 tips for stunning listing videos"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label>URL slug</Label>
                  <Input
                    value={effectiveSlug}
                    onChange={e => {
                      setSlugTouched(true);
                      set("slug", slugify(e.target.value));
                    }}
                    placeholder="auto-generated-from-title"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label>Excerpt (summary shown in listings & search)</Label>
                  <Textarea
                    value={form.excerpt}
                    onChange={e => set("excerpt", e.target.value)}
                    rows={2}
                    placeholder="A short, catchy summary (auto-generated if left blank)."
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label>Content (HTML supported)</Label>
                  <Textarea
                    value={form.content}
                    onChange={e => set("content", e.target.value)}
                    rows={16}
                    placeholder={"<p>Write your article here. HTML tags like <h2>, <p>, <ul>, <img>, <a> work.</p>\n<p>You can also paste AdSense in-article ad units.</p>"}
                    className="mt-1.5 font-mono text-sm"
                  />
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Use HTML tags for formatting. In-article AdSense ad units can
                    be pasted directly into the content.
                  </p>
                </div>
              </div>

              {/* Sidebar */}
              <div className="space-y-4">
                <div className="rounded-2xl border border-zinc-200 p-4">
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      disabled={saving}
                      onClick={() => handleSave("published")}
                      className="rounded-xl"
                    >
                      {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Publish
                    </Button>
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={() => handleSave("draft")}
                      className="rounded-xl"
                    >
                      Save draft
                    </Button>
                  </div>
                  {previewUrl && form.status === "published" && (
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> View live
                    </a>
                  )}
                </div>

                <div>
                  <Label>Category</Label>
                  <select
                    value={form.categoryId}
                    onChange={e => set("categoryId", Number(e.target.value))}
                    className="mt-1.5 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                  >
                    <option value="">Choose a category</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label>Cover image</Label>
                  <div className="mt-1.5 space-y-2">
                    {form.coverImageUrl && (
                      <img
                        src={form.coverImageUrl}
                        alt="cover preview"
                        className="h-28 w-full rounded-xl object-cover"
                      />
                    )}
                    <Input
                      value={form.coverImageUrl}
                      onChange={e => set("coverImageUrl", e.target.value)}
                      placeholder="Paste an image URL or upload"
                    />
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) void handleCoverUpload(f);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={uploading}
                      onClick={() => coverInputRef.current?.click()}
                      className="w-full rounded-xl"
                    >
                      {uploading ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Upload image
                    </Button>
                    <Input
                      value={form.coverImageAlt}
                      onChange={e => set("coverImageAlt", e.target.value)}
                      placeholder="Image alt text (accessibility & SEO)"
                    />
                  </div>
                </div>

                <div>
                  <Label>Author</Label>
                  <Input
                    value={form.authorName}
                    onChange={e => set("authorName", e.target.value)}
                    placeholder="Defaults to blog author"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label>Tags (comma separated)</Label>
                  <Input
                    value={form.tags}
                    onChange={e => set("tags", e.target.value)}
                    placeholder="real estate, video, tips"
                    className="mt-1.5"
                  />
                </div>
              </div>
            </div>

            {/* SEO section */}
            <div className="mt-6 rounded-2xl border border-zinc-200 p-4">
              <h3 className="font-display text-sm">Search engine (SEO) options</h3>
              <p className="mt-1 text-[11px] text-zinc-400">
                Leave blank to auto-fill from the title, excerpt, and cover image.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>SEO title</Label>
                  <Input
                    value={form.seoTitle}
                    onChange={e => set("seoTitle", e.target.value)}
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label>Canonical URL</Label>
                  <Input
                    value={form.canonicalUrl}
                    onChange={e => set("canonicalUrl", e.target.value)}
                    placeholder="Only if this content lives elsewhere"
                    className="mt-1.5"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>Meta description</Label>
                  <Textarea
                    value={form.seoDescription}
                    onChange={e => set("seoDescription", e.target.value)}
                    rows={2}
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label>Social share image (OG image)</Label>
                  <Input
                    value={form.ogImageUrl}
                    onChange={e => set("ogImageUrl", e.target.value)}
                    placeholder="Defaults to cover image"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label>Meta keywords</Label>
                  <Input
                    value={form.metaKeywords}
                    onChange={e => set("metaKeywords", e.target.value)}
                    className="mt-1.5"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================ Category editor ============================

interface CategoryFormState {
  id?: number;
  name: string;
  slug: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
  sortOrder: string;
}

const emptyCategory: CategoryFormState = {
  name: "",
  slug: "",
  description: "",
  seoTitle: "",
  seoDescription: "",
  sortOrder: "0",
};

function CategoryEditor({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: CategoryFormState | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CategoryFormState>(emptyCategory);
  const [slugTouched, setSlugTouched] = useState(false);
  const createMutation = trpc.blog.createCategory.useMutation();
  const updateMutation = trpc.blog.updateCategory.useMutation();

  useEffect(() => {
    if (open) {
      setForm(editing ?? emptyCategory);
      setSlugTouched(Boolean(editing));
    }
  }, [open, editing]);

  const set = <K extends keyof CategoryFormState>(
    key: K,
    value: CategoryFormState[K]
  ) => setForm(prev => ({ ...prev, [key]: value }));

  const effectiveSlug = slugTouched ? form.slug : slugify(form.name);
  const saving = createMutation.isPending || updateMutation.isPending;

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error("Add a category name");
    const payload = {
      name: form.name.trim(),
      slug: (slugTouched ? form.slug : "") || undefined,
      description: form.description || undefined,
      seoTitle: form.seoTitle || undefined,
      seoDescription: form.seoDescription || undefined,
      sortOrder: Number(form.sortOrder) || 0,
    };
    try {
      if (form.id) {
        await updateMutation.mutateAsync({ id: form.id, ...payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      toast.success("Category saved");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save category");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,32rem)] rounded-3xl bg-white p-6">
        <DialogTitle>{form.id ? "Edit category" : "New category"}</DialogTitle>
        <div className="mt-4 space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={e => set("name", e.target.value)}
              placeholder="Guides"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label>URL slug</Label>
            <Input
              value={effectiveSlug}
              onChange={e => {
                setSlugTouched(true);
                set("slug", slugify(e.target.value));
              }}
              className="mt-1.5"
            />
            <p className="mt-1 text-[11px] text-zinc-400">
              Articles will live at <code>/{effectiveSlug || "slug"}/article-name</code>
            </p>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={e => set("description", e.target.value)}
              rows={2}
              className="mt-1.5"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>SEO title</Label>
              <Input
                value={form.seoTitle}
                onChange={e => set("seoTitle", e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Sort order</Label>
              <Input
                type="number"
                value={form.sortOrder}
                onChange={e => set("sortOrder", e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>
          <div>
            <Label>Meta description</Label>
            <Textarea
              value={form.seoDescription}
              onChange={e => set("seoDescription", e.target.value)}
              rows={2}
              className="mt-1.5"
            />
          </div>
          <Button
            disabled={saving}
            onClick={handleSave}
            className="w-full rounded-xl"
          >
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save category
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================ Settings ============================

function BlogSettingsPanel() {
  const utils = trpc.useUtils();
  const settingsQuery = trpc.blog.getSettings.useQuery();
  const mutation = trpc.blog.updateSettings.useMutation({
    onSuccess: () => {
      toast.success("Blog settings saved");
      utils.blog.getSettings.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const [form, setForm] = useState({
    siteName: "",
    blogTitle: "",
    siteDescription: "",
    siteUrl: "",
    defaultAuthorName: "",
    adsenseClientId: "",
    adsenseHeaderCode: "",
    adsenseFooterCode: "",
    customHeadHtml: "",
    customCss: "",
    postFooterHtml: "",
  });

  useEffect(() => {
    const s = settingsQuery.data;
    if (s) {
      setForm({
        siteName: s.siteName ?? "",
        blogTitle: s.blogTitle ?? "",
        siteDescription: s.siteDescription ?? "",
        siteUrl: s.siteUrl ?? "",
        defaultAuthorName: s.defaultAuthorName ?? "",
        adsenseClientId: s.adsenseClientId ?? "",
        adsenseHeaderCode: s.adsenseHeaderCode ?? "",
        adsenseFooterCode: s.adsenseFooterCode ?? "",
        customHeadHtml: s.customHeadHtml ?? "",
        customCss: s.customCss ?? "",
        postFooterHtml: s.postFooterHtml ?? "",
      });
    }
  }, [settingsQuery.data]);

  const set = (key: keyof typeof form, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  if (settingsQuery.isLoading) {
    return <Skeleton className="h-96 w-full rounded-3xl" />;
  }

  const save = () => {
    if (!form.siteName.trim()) {
      toast.error("Site name is required");
      return;
    }
    mutation.mutate(form);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-zinc-200 bg-white p-6">
        <h3 className="font-display text-lg">Site & SEO defaults</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Site name</Label>
            <Input
              value={form.siteName}
              onChange={e => set("siteName", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label>Blog heading</Label>
            <Input
              value={form.blogTitle}
              onChange={e => set("blogTitle", e.target.value)}
              placeholder="The EstateTour Blog"
              className="mt-1.5"
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Site description</Label>
            <Textarea
              value={form.siteDescription}
              onChange={e => set("siteDescription", e.target.value)}
              rows={2}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label>Public site URL</Label>
            <Input
              value={form.siteUrl}
              onChange={e => set("siteUrl", e.target.value)}
              placeholder="https://yourdomain.com"
              className="mt-1.5"
            />
            <p className="mt-1 text-[11px] text-zinc-400">
              Used for canonical URLs, sitemap, and social share links.
            </p>
          </div>
          <div>
            <Label>Default author name</Label>
            <Input
              value={form.defaultAuthorName}
              onChange={e => set("defaultAuthorName", e.target.value)}
              className="mt-1.5"
            />
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-zinc-200 bg-white p-6">
        <h3 className="font-display text-lg">Google AdSense</h3>
        <p className="mt-1 text-xs text-zinc-400">
          Paste the code Google gives you. The header code goes in every page's
          <code className="mx-1 rounded bg-zinc-100 px-1">&lt;head&gt;</code>; the
          footer code loads before <code className="rounded bg-zinc-100 px-1">&lt;/body&gt;</code>.
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <Label>AdSense publisher ID</Label>
            <Input
              value={form.adsenseClientId}
              onChange={e => set("adsenseClientId", e.target.value)}
              placeholder="ca-pub-1234567890123456"
              className="mt-1.5"
            />
            <p className="mt-1 text-[11px] text-zinc-400">
              When set, the AdSense loader script and <code>/ads.txt</code> are
              generated automatically.
            </p>
          </div>
          <div>
            <Label>Header code (injected into &lt;head&gt;)</Label>
            <Textarea
              value={form.adsenseHeaderCode}
              onChange={e => set("adsenseHeaderCode", e.target.value)}
              rows={4}
              placeholder='<script async src="https://pagead2.googlesyndication.com/..."></script>'
              className="mt-1.5 font-mono text-xs"
            />
          </div>
          <div>
            <Label>Footer code (injected before &lt;/body&gt;)</Label>
            <Textarea
              value={form.adsenseFooterCode}
              onChange={e => set("adsenseFooterCode", e.target.value)}
              rows={4}
              className="mt-1.5 font-mono text-xs"
            />
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-zinc-200 bg-white p-6">
        <h3 className="font-display text-lg">Custom code</h3>
        <div className="mt-4 space-y-4">
          <div>
            <Label>Custom CSS (styles every blog page)</Label>
            <Textarea
              value={form.customCss}
              onChange={e => set("customCss", e.target.value)}
              rows={5}
              placeholder=".prose h2 { color: #E894B5; }"
              className="mt-1.5 font-mono text-xs"
            />
          </div>
          <div>
            <Label>Extra &lt;head&gt; HTML (analytics, verification tags)</Label>
            <Textarea
              value={form.customHeadHtml}
              onChange={e => set("customHeadHtml", e.target.value)}
              rows={4}
              className="mt-1.5 font-mono text-xs"
            />
          </div>
          <div>
            <Label>Post footer HTML (shown after every article)</Label>
            <Textarea
              value={form.postFooterHtml}
              onChange={e => set("postFooterHtml", e.target.value)}
              rows={4}
              placeholder="Newsletter signup, related links, or an ad unit."
              className="mt-1.5 font-mono text-xs"
            />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button
          disabled={mutation.isPending}
          onClick={save}
          className="rounded-xl px-8"
        >
          {mutation.isPending && (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          )}
          Save all settings
        </Button>
      </div>
    </div>
  );
}

// ============================ Main ============================

export default function BlogAdmin() {
  const utils = trpc.useUtils();
  const [view, setView] = useState<BlogView>("posts");
  const [postSearch, setPostSearch] = useState("");
  const [postPage, setPostPage] = useState(1);
  const [postEditorOpen, setPostEditorOpen] = useState(false);
  const [editingPostId, setEditingPostId] = useState<number | null>(null);
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false);
  const [editingCategory, setEditingCategory] =
    useState<CategoryFormState | null>(null);

  const categoriesQuery = trpc.blog.adminListCategories.useQuery();
  const postsQuery = trpc.blog.adminListPosts.useQuery({
    page: postPage,
    pageSize: 20,
    search: postSearch || undefined,
  });
  const deletePostMutation = trpc.blog.deletePost.useMutation();
  const deleteCategoryMutation = trpc.blog.deleteCategory.useMutation();

  const categoryOptions = useMemo(
    () =>
      (categoriesQuery.data ?? []).map(c => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
      })),
    [categoriesQuery.data]
  );

  const refreshPosts = () => {
    utils.blog.adminListPosts.invalidate();
    utils.blog.adminListCategories.invalidate();
  };
  const refreshCategories = () => {
    utils.blog.adminListCategories.invalidate();
  };

  const handleDeletePost = async (id: number, title: string) => {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    try {
      await deletePostMutation.mutateAsync({ id });
      toast.success("Post deleted");
      refreshPosts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const handleDeleteCategory = async (id: number, name: string) => {
    if (!window.confirm(`Delete the "${name}" category?`)) return;
    try {
      await deleteCategoryMutation.mutateAsync({ id });
      toast.success("Category deleted");
      refreshCategories();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const tabs: Array<{ id: BlogView; label: string; icon: typeof FileText }> = [
    { id: "posts", label: "Posts", icon: FileText },
    { id: "categories", label: "Categories", icon: FolderTree },
    { id: "settings", label: "Settings", icon: Settings2 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
              view === t.id
                ? "bg-zinc-950 text-white"
                : "bg-white text-zinc-600 hover:bg-zinc-100 border border-zinc-200"
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
        <a
          href="/blog"
          target="_blank"
          rel="noreferrer"
          className="ml-auto flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
        >
          <ExternalLink className="h-4 w-4" /> View blog
        </a>
      </div>

      {/* ===== Posts ===== */}
      {view === "posts" && (
        <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-zinc-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                value={postSearch}
                onChange={e => {
                  setPostSearch(e.target.value);
                  setPostPage(1);
                }}
                placeholder="Search posts…"
                className="pl-9"
              />
            </div>
            <Button
              onClick={() => {
                if (categoryOptions.length === 0) {
                  toast.error("Create a category first");
                  setView("categories");
                  return;
                }
                setEditingPostId(null);
                setPostEditorOpen(true);
              }}
              className="rounded-xl"
            >
              <Plus className="mr-1.5 h-4 w-4" /> New post
            </Button>
          </div>

          {postsQuery.isLoading ? (
            <div className="p-8">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
            </div>
          ) : postsQuery.data?.items.length ? (
            <ul className="divide-y divide-zinc-100">
              {postsQuery.data.items.map(post => (
                <li
                  key={post.id}
                  className="flex items-center gap-4 p-4 hover:bg-zinc-50"
                >
                  <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-100">
                    {post.coverImageUrl && (
                      <img
                        src={post.coverImageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{post.title}</p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {post.categoryName} · /{post.categorySlug}/{post.slug}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize",
                      post.status === "published"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                    )}
                  >
                    {post.status}
                  </span>
                  <span className="hidden text-xs text-zinc-400 sm:block">
                    {formatDate(post.updatedAt)}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 rounded-full p-0"
                      onClick={() => {
                        setEditingPostId(post.id);
                        setPostEditorOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 rounded-full p-0 text-red-600"
                      onClick={() => handleDeletePost(post.id, post.title)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-12 text-center text-sm text-zinc-500">
              <FileText className="mx-auto h-8 w-8 text-zinc-300" />
              <p className="mt-3">No posts yet. Click “New post” to write one.</p>
            </div>
          )}

          {postsQuery.data && postsQuery.data.pageCount > 1 && (
            <div className="flex items-center justify-end gap-2 border-t border-zinc-100 p-3 text-xs text-zinc-500">
              <Button
                size="sm"
                variant="outline"
                disabled={postPage <= 1}
                onClick={() => setPostPage(p => p - 1)}
                className="h-8 rounded-full"
              >
                Previous
              </Button>
              <span>
                Page {postPage} of {postsQuery.data.pageCount}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={postPage >= postsQuery.data.pageCount}
                onClick={() => setPostPage(p => p + 1)}
                className="h-8 rounded-full"
              >
                Next
              </Button>
            </div>
          )}
        </section>
      )}

      {/* ===== Categories ===== */}
      {view === "categories" && (
        <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-white">
          <div className="flex items-center justify-between border-b border-zinc-100 p-4">
            <h3 className="font-display text-lg">Categories</h3>
            <Button
              onClick={() => {
                setEditingCategory(null);
                setCategoryEditorOpen(true);
              }}
              className="rounded-xl"
            >
              <Plus className="mr-1.5 h-4 w-4" /> New category
            </Button>
          </div>
          {categoriesQuery.isLoading ? (
            <div className="p-8">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
            </div>
          ) : categoriesQuery.data?.length ? (
            <ul className="divide-y divide-zinc-100">
              {categoriesQuery.data.map(c => (
                <li
                  key={c.id}
                  className="flex items-center gap-4 p-4 hover:bg-zinc-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{c.name}</p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      /{c.slug} · {c.postCount} post{c.postCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 rounded-full p-0"
                      onClick={() => {
                        setEditingCategory({
                          id: c.id,
                          name: c.name,
                          slug: c.slug,
                          description: c.description ?? "",
                          seoTitle: c.seoTitle ?? "",
                          seoDescription: c.seoDescription ?? "",
                          sortOrder: String(c.sortOrder ?? 0),
                        });
                        setCategoryEditorOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 rounded-full p-0 text-red-600"
                      onClick={() => handleDeleteCategory(c.id, c.name)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-12 text-center text-sm text-zinc-500">
              <FolderTree className="mx-auto h-8 w-8 text-zinc-300" />
              <p className="mt-3">
                No categories yet. Create one to start publishing.
              </p>
            </div>
          )}
        </section>
      )}

      {/* ===== Settings ===== */}
      {view === "settings" && <BlogSettingsPanel />}

      <PostEditor
        open={postEditorOpen}
        onOpenChange={setPostEditorOpen}
        editingId={editingPostId}
        categories={categoryOptions}
        onSaved={refreshPosts}
      />
      <CategoryEditor
        open={categoryEditorOpen}
        onOpenChange={setCategoryEditorOpen}
        editing={editingCategory}
        onSaved={refreshCategories}
      />
    </div>
  );
}
